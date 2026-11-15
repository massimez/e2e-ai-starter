import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { db } from "@workspace/db";
import { Hono } from "hono";
import { app } from "../src/app";
import { auth } from "../src/lib/auth";
import type { AppEnv } from "../src/lib/create-hono-app";
import { redis } from "../src/lib/redis/client";
import { hasOrgPermission } from "../src/middleware/org-permission";
import { resetMemoryRateLimiter } from "../src/middleware/rate-limiter";
import * as emailQueue from "../src/modules/email/queue";
import {
	createOrganizationRole,
	deleteOrganizationRole,
	getPermissionCatalog,
	rolesService,
	updateOrganizationMemberRole,
	updateOrganizationRole,
	userHasOrganizationPermission,
} from "../src/modules/roles/service";

const ORG_ID = "org_test_1";
const OWNER_USER_ID = "usr_owner_1";
const ADMIN_USER_ID = "usr_admin_1";
const MEMBER_USER_ID = "usr_member_1";
const ROLE_UUID = "11111111-1111-4111-8111-111111111111";
const SYSTEM_ROLE_UUID = "22222222-2222-4222-8222-222222222222";

function createQueryChain<T>(result: T) {
	const chain = {
		from: () => chain,
		limit: () => Promise.resolve(result),
		onConflictDoNothing: () => chain,
		onConflictDoUpdate: () => chain,
		returning: () => Promise.resolve(result),
		set: () => chain,
		// biome-ignore lint/suspicious/noThenProperty: test double emulates Drizzle awaitable builder
		then: <R>(
			onfulfilled?: (value: T) => R | PromiseLike<R>,
			onrejected?: (reason: unknown) => R | PromiseLike<R>
		) => Promise.resolve(result).then(onfulfilled, onrejected),
		values: () => chain,
		where: () => chain,
	};
	return chain;
}

function mockSession(overrides?: {
	activeOrganizationId?: string | null;
	userId?: string;
}) {
	const activeOrganizationId =
		overrides?.activeOrganizationId === undefined
			? ORG_ID
			: overrides.activeOrganizationId;
	const userId = overrides?.userId ?? OWNER_USER_ID;

	return spyOn(auth.api, "getSession").mockResolvedValue({
		session: {
			activeOrganizationId,
			expiresAt: new Date(Date.now() + 3_600_000),
			id: "sess_test_1",
			token: "tok_test_1",
			userId,
		},
		user: {
			banned: false,
			email: "owner@acme.example",
			id: userId,
			name: "Owner User",
		},
	} as never);
}

describe("hasOrgPermission middleware", () => {
	afterEach(() => {
		mock.restore();
	});

	function createMiddlewareTestApp(variables?: {
		activeOrganizationId?: string | null;
		userId?: string | null;
	}) {
		const testApp = new Hono<AppEnv>();
		testApp.use("*", async (c, next) => {
			c.set(
				"session",
				variables?.activeOrganizationId === undefined
					? ({ activeOrganizationId: ORG_ID } as AppEnv["Variables"]["session"])
					: ({
							activeOrganizationId: variables.activeOrganizationId,
						} as AppEnv["Variables"]["session"])
			);
			c.set(
				"user",
				variables?.userId === null
					? null
					: ({
							id: variables?.userId ?? OWNER_USER_ID,
						} as AppEnv["Variables"]["user"])
			);
			await next();
		});
		testApp.get("/protected", hasOrgPermission("storage:read"), (c) =>
			c.json({ ok: true })
		);
		testApp.get("/invalid", hasOrgPermission("invalid_format"), (c) =>
			c.json({ ok: true })
		);
		testApp.get(
			"/double",
			hasOrgPermission("storage:read"),
			hasOrgPermission("storage:read"),
			(c) => c.json({ ok: true })
		);
		return testApp;
	}

	test("returns 400 when activeOrganizationId is missing", async () => {
		const testApp = createMiddlewareTestApp({ activeOrganizationId: null });
		const res = await testApp.request("/protected");
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error: { issues?: { code?: string }[] };
		};
		expect(body.error.issues?.[0]?.code).toBe("MISSING_ORG_ID");
	});

	test("returns 401 when user is not present in context", async () => {
		const testApp = createMiddlewareTestApp({ userId: null });
		const res = await testApp.request("/protected");
		expect(res.status).toBe(401);
	});

	test("returns 400 when permission format lacks resource:action", async () => {
		const testApp = createMiddlewareTestApp();
		const res = await testApp.request("/invalid");
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error: { issues?: { code?: string }[] };
		};
		expect(body.error.issues?.[0]?.code).toBe("INVALID_PERMISSION");
	});

	test("returns 403 when dynamic permission check denies access", async () => {
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			false
		);
		const testApp = createMiddlewareTestApp({ userId: MEMBER_USER_ID });
		const res = await testApp.request("/protected");
		expect(res.status).toBe(403);
	});

	test("allows request and deduplicates repeated checks in the same request", async () => {
		const spy = spyOn(
			rolesService,
			"userHasOrganizationPermission"
		).mockResolvedValue(true);
		const testApp = createMiddlewareTestApp();
		const res = await testApp.request("/double");
		expect(res.status).toBe(200);
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

describe("dynamic roles service", () => {
	afterEach(() => {
		mock.restore();
	});

	test("getPermissionCatalog excludes non-delegable permissions", () => {
		const catalog = getPermissionCatalog();
		const allKeys = catalog.flatMap((group) =>
			group.permissions.map((item) => item.key)
		);
		expect(allKeys).not.toContain("role:create");
		expect(allKeys).not.toContain("role:assign");
		expect(allKeys).not.toContain("member:invite");
		expect(allKeys).not.toContain("organization:delete");
		expect(allKeys).toContain("ai:execute");
		expect(allKeys).toContain("storage:read");
	});

	test("userHasOrganizationPermission bypasses lookup for owner role", async () => {
		const redisGetSpy = spyOn(redis, "get");
		const allowed = await userHasOrganizationPermission({
			memberRole: "owner",
			organizationId: ORG_ID,
			permission: "ai:execute",
			userId: OWNER_USER_ID,
		});
		expect(allowed).toBe(true);
		expect(redisGetSpy).not.toHaveBeenCalled();
	});

	test("userHasOrganizationPermission uses Redis cache when present", async () => {
		spyOn(redis, "get").mockResolvedValue(JSON.stringify(["storage:read"]));
		const findRoleSpy = spyOn(db.query.organizationRole, "findFirst");

		expect(
			await userHasOrganizationPermission({
				memberRole: "finance-reviewer",
				organizationId: ORG_ID,
				permission: "storage:read",
				userId: MEMBER_USER_ID,
			})
		).toBe(true);

		expect(
			await userHasOrganizationPermission({
				memberRole: "finance-reviewer",
				organizationId: ORG_ID,
				permission: "storage:delete",
				userId: MEMBER_USER_ID,
			})
		).toBe(false);

		expect(findRoleSpy).not.toHaveBeenCalled();
	});

	test("userHasOrganizationPermission falls back to DB and populates Redis on cache miss", async () => {
		spyOn(redis, "get").mockResolvedValue(null);
		const redisSetSpy = spyOn(redis, "set").mockResolvedValue("OK" as never);
		spyOn(db.query.organizationRole, "findFirst").mockResolvedValue({
			id: ROLE_UUID,
			organizationId: ORG_ID,
			permissions: [{ action: "execute", resource: "ai" }],
			slug: "analyst",
		} as never);

		const allowed = await userHasOrganizationPermission({
			memberRole: "analyst",
			organizationId: ORG_ID,
			permission: "ai:execute",
			userId: MEMBER_USER_ID,
		});

		expect(allowed).toBe(true);
		expect(redisSetSpy).toHaveBeenCalledTimes(1);
	});

	test("createOrganizationRole rejects non-owners with 403 OWNER_ROLE_REQUIRED", async () => {
		spyOn(db.query.member, "findFirst").mockResolvedValue({
			id: "mem_admin",
			role: "admin",
		} as never);

		await expect(
			createOrganizationRole(
				ORG_ID,
				{
					name: "Finance Reviewer",
					permissions: ["billing:read"],
				},
				ADMIN_USER_ID
			)
		).rejects.toMatchObject({
			code: "OWNER_ROLE_REQUIRED",
			statusCode: 403,
		});
	});

	test("createOrganizationRole rejects non-delegable permissions with 403 NON_DELEGABLE_PERMISSION", async () => {
		spyOn(db.query.member, "findFirst").mockResolvedValue({
			id: "mem_owner",
			role: "owner",
		} as never);

		await expect(
			createOrganizationRole(
				ORG_ID,
				{
					name: "Shadow Admin",
					permissions: ["role:create"],
				},
				OWNER_USER_ID
			)
		).rejects.toMatchObject({
			code: "NON_DELEGABLE_PERMISSION",
			statusCode: 403,
		});
	});

	test("updateOrganizationRole locks owner role and system role slugs", async () => {
		spyOn(db.query.member, "findFirst").mockResolvedValue({
			id: "mem_owner",
			role: "owner",
		} as never);

		spyOn(db.query.organizationRole, "findFirst").mockResolvedValueOnce({
			description: "Owner",
			id: SYSTEM_ROLE_UUID,
			isDefault: false,
			isSystem: true,
			name: "Owner",
			organizationId: ORG_ID,
			permissions: [],
			slug: "owner",
		} as never);

		await expect(
			updateOrganizationRole(
				ORG_ID,
				SYSTEM_ROLE_UUID,
				{ name: "Super Owner" },
				OWNER_USER_ID
			)
		).rejects.toMatchObject({
			code: "OWNER_ROLE_LOCKED",
			statusCode: 403,
		});

		spyOn(db.query.organizationRole, "findFirst").mockResolvedValueOnce({
			description: "Member",
			id: SYSTEM_ROLE_UUID,
			isDefault: true,
			isSystem: true,
			name: "Member",
			organizationId: ORG_ID,
			permissions: [],
			slug: "member",
		} as never);

		await expect(
			updateOrganizationRole(
				ORG_ID,
				SYSTEM_ROLE_UUID,
				{ slug: "custom-member" },
				OWNER_USER_ID
			)
		).rejects.toMatchObject({
			code: "SYSTEM_ROLE_SLUG_LOCKED",
			statusCode: 400,
		});
	});

	test("deleteOrganizationRole blocks system roles (403) and in-use custom roles (409)", async () => {
		spyOn(db.query.member, "findFirst").mockResolvedValue({
			id: "mem_owner",
			role: "owner",
		} as never);

		spyOn(db.query.organizationRole, "findFirst").mockResolvedValueOnce({
			id: SYSTEM_ROLE_UUID,
			isSystem: true,
			organizationId: ORG_ID,
			permissions: [],
			slug: "admin",
		} as never);

		await expect(
			deleteOrganizationRole(ORG_ID, SYSTEM_ROLE_UUID, OWNER_USER_ID)
		).rejects.toMatchObject({
			code: "SYSTEM_ROLE_LOCKED",
			statusCode: 403,
		});

		spyOn(db.query.organizationRole, "findFirst").mockResolvedValueOnce({
			id: ROLE_UUID,
			isSystem: false,
			organizationId: ORG_ID,
			permissions: [],
			slug: "finance-reviewer",
		} as never);
		spyOn(db, "select").mockReturnValue(
			createQueryChain([{ role: "finance-reviewer" }]) as never
		);

		await expect(
			deleteOrganizationRole(ORG_ID, ROLE_UUID, OWNER_USER_ID)
		).rejects.toMatchObject({
			code: "ROLE_HAS_MEMBERS",
			statusCode: 409,
		});
	});

	test("updateOrganizationMemberRole updates member to a custom role slug", async () => {
		spyOn(db.query.member, "findFirst")
			.mockResolvedValueOnce({ id: "mem_owner", role: "owner" } as never)
			.mockResolvedValueOnce({
				id: "mem_target",
				organizationId: ORG_ID,
				role: "member",
				userId: MEMBER_USER_ID,
			} as never);
		spyOn(db.query.organizationRole, "findFirst").mockResolvedValue({
			id: ROLE_UUID,
			organizationId: ORG_ID,
			permissions: [],
			slug: "finance-reviewer",
		} as never);
		spyOn(db, "update").mockReturnValue(
			createQueryChain([
				{
					id: "mem_target",
					organizationId: ORG_ID,
					role: "finance-reviewer",
					userId: MEMBER_USER_ID,
				},
			]) as never
		);

		const updated = await updateOrganizationMemberRole(
			ORG_ID,
			"mem_target",
			"finance-reviewer",
			OWNER_USER_ID
		);

		expect(updated?.role).toBe("finance-reviewer");
	});
});

describe("roles & invitations HTTP routes", () => {
	beforeEach(() => {
		resetMemoryRateLimiter();
	});

	afterEach(() => {
		mock.restore();
	});

	test("POST /api/organizations/roles creates a custom role for owner", async () => {
		mockSession({ userId: OWNER_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			true
		);
		const createSpy = spyOn(
			rolesService,
			"createOrganizationRole"
		).mockResolvedValue({
			description: "Reviews billing invoices",
			id: ROLE_UUID,
			isDefault: false,
			isSystem: false,
			memberCount: 0,
			name: "Finance Reviewer",
			permissions: ["billing:read", "storage:read"],
			slug: "finance-reviewer",
		});

		const res = await app.request("/api/organizations/roles", {
			body: JSON.stringify({
				description: "Reviews billing invoices",
				name: "Finance Reviewer",
				permissions: ["billing:read", "storage:read"],
			}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});

		expect(res.status).toBe(201);
		expect(createSpy).toHaveBeenCalledTimes(1);
		const body = (await res.json()) as {
			data: { slug: string };
			success: boolean;
		};
		expect(body.success).toBe(true);
		expect(body.data.slug).toBe("finance-reviewer");
	});

	test("PATCH /api/organizations/roles/members/:memberId assigns a custom role slug", async () => {
		mockSession({ userId: OWNER_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			true
		);
		spyOn(rolesService, "updateOrganizationMemberRole").mockResolvedValue({
			id: "mem_target",
			organizationId: ORG_ID,
			role: "finance-reviewer",
			userId: MEMBER_USER_ID,
		} as never);

		const res = await app.request(
			"/api/organizations/roles/members/mem_target",
			{
				body: JSON.stringify({ roleSlug: "finance-reviewer" }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { role: string };
			success: boolean;
		};
		expect(body.success).toBe(true);
		expect(body.data.role).toBe("finance-reviewer");
	});

	test("POST /api/organizations/invitations accepts custom role slugs behind member:invite", async () => {
		mockSession({ userId: ADMIN_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			true
		);
		spyOn(db.query.organizationRole, "findFirst").mockResolvedValue({
			id: ROLE_UUID,
			organizationId: ORG_ID,
			permissions: [],
			slug: "finance-reviewer",
		} as never);
		spyOn(db.query.user, "findFirst").mockResolvedValue(undefined as never);
		spyOn(db, "select").mockReturnValue(
			createQueryChain([{ id: ORG_ID, name: "Acme Corp" }]) as never
		);
		spyOn(db.query.invitation, "findFirst").mockResolvedValue(
			undefined as never
		);
		spyOn(db, "insert").mockReturnValue(
			createQueryChain([
				{
					email: "reviewer@acme.example",
					expiresAt: new Date(Date.now() + 3_600_000),
					id: "inv_custom_1",
					inviterId: ADMIN_USER_ID,
					organizationId: ORG_ID,
					role: "finance-reviewer",
					status: "pending",
				},
			]) as never
		);
		spyOn(emailQueue, "enqueueEmail").mockResolvedValue(undefined as never);

		const res = await app.request("/api/organizations/invitations", {
			body: JSON.stringify({
				email: "reviewer@acme.example",
				role: "finance-reviewer",
			}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});

		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			data: { resent: boolean; role: string };
			success: boolean;
		};
		expect(body.success).toBe(true);
		expect(body.data.resent).toBe(false);
		expect(body.data.role).toBe("finance-reviewer");
	});

	test("POST /api/organizations/invitations rejects inviting as owner with 403", async () => {
		mockSession({ userId: OWNER_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			true
		);

		const res = await app.request("/api/organizations/invitations", {
			body: JSON.stringify({
				email: "newowner@acme.example",
				role: "owner",
			}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});

		expect(res.status).toBe(403);
	});

	test("POST /api/organizations/invitations rejects non-owner inviting as admin with 403", async () => {
		mockSession({ userId: ADMIN_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			true
		);
		spyOn(db.query.organizationRole, "findFirst").mockResolvedValue({
			id: SYSTEM_ROLE_UUID,
			organizationId: ORG_ID,
			permissions: [],
			slug: "admin",
		} as never);
		spyOn(db.query.member, "findFirst").mockResolvedValue({
			role: "admin",
		} as never);

		const res = await app.request("/api/organizations/invitations", {
			body: JSON.stringify({
				email: "escalated@acme.example",
				role: "admin",
			}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});

		expect(res.status).toBe(403);
	});

	test("disables static-RBAC Better Auth organization mutation endpoints (404)", async () => {
		const responses = await Promise.all(
			[
				"/api/auth/organization/update-member-role",
				"/api/auth/organization/invite-member",
				"/api/auth/organization/cancel-invitation",
				"/api/auth/organization/update",
				"/api/auth/organization/remove-member",
				"/api/auth/organization/has-permission",
				"/api/auth/organization/create-role",
			].map((path) =>
				app.request(path, {
					body: JSON.stringify({}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				})
			)
		);
		for (const res of responses) {
			expect(res.status).toBe(404);
		}
	});

	test("PATCH /api/organizations/current enforces dynamic organization:update permission", async () => {
		mockSession({ userId: MEMBER_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			false
		);

		const denied = await app.request("/api/organizations/current", {
			body: JSON.stringify({ name: "Renamed Org" }),
			headers: { "Content-Type": "application/json" },
			method: "PATCH",
		});
		expect(denied.status).toBe(403);

		mock.restore();
		mockSession({ userId: MEMBER_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			true
		);
		spyOn(db, "select").mockReturnValue(
			createQueryChain([
				{
					id: ORG_ID,
					logo: null,
					metadata: null,
					name: "Acme Corp",
					slug: "acme-corp",
				},
			]) as never
		);
		spyOn(db, "update").mockReturnValue(
			createQueryChain([
				{
					id: ORG_ID,
					logo: null,
					metadata: null,
					name: "Renamed Org",
					slug: "acme-corp",
				},
			]) as never
		);

		const allowed = await app.request("/api/organizations/current", {
			body: JSON.stringify({ name: "Renamed Org" }),
			headers: { "Content-Type": "application/json" },
			method: "PATCH",
		});
		expect(allowed.status).toBe(200);
	});

	test("DELETE /api/organizations/members/:memberId enforces dynamic member:remove permission", async () => {
		mockSession({ userId: ADMIN_USER_ID });
		spyOn(rolesService, "userHasOrganizationPermission").mockResolvedValue(
			false
		);

		const denied = await app.request("/api/organizations/members/mem_target", {
			method: "DELETE",
		});
		expect(denied.status).toBe(403);
	});

	test("updateOrganizationRole rejects unsetting isDefault on the active default role", async () => {
		spyOn(db.query.member, "findFirst").mockResolvedValue({
			role: "owner",
		} as never);
		spyOn(db.query.organizationRole, "findFirst").mockResolvedValue({
			description: "Standard collaborator",
			id: SYSTEM_ROLE_UUID,
			isDefault: true,
			isSystem: true,
			name: "Member",
			organizationId: ORG_ID,
			permissions: [],
			slug: "member",
		} as never);

		await expect(
			updateOrganizationRole(
				ORG_ID,
				SYSTEM_ROLE_UUID,
				{ isDefault: false },
				OWNER_USER_ID
			)
		).rejects.toThrow("Select another role as default");
	});
});
