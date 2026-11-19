import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { db } from "@workspace/db";
import { Hono } from "hono";
import { auth } from "../src/lib/auth";
import type { AppEnv } from "../src/lib/create-hono-app";
import { hasOrgPermission } from "../src/middleware/org-permission";
import { notificationQueue } from "../src/modules/notification/queue";
import { notificationRoutes } from "../src/modules/notification/route";
import {
	notificationService,
	pushEndpointResolver,
} from "../src/modules/notification/service";
import { organizationRoutes } from "../src/modules/organization/route";
import { updateOrganizationSchema } from "../src/modules/organization/schema";
import { transferOwnership } from "../src/modules/organization/service";

function createQueryChain<T>(result: T) {
	const chain = {
		for: () => chain,
		from: () => chain,
		limit: () => Promise.resolve(result),
		orderBy: () => chain,
		returning: () => Promise.resolve(result),
		set: () => chain,
		// biome-ignore lint/suspicious/noThenProperty: test double emulates Drizzle awaitable builder
		then: <R>(
			onfulfilled?: (value: T) => R | PromiseLike<R>,
			onrejected?: (reason: unknown) => R | PromiseLike<R>
		) => Promise.resolve(result).then(onfulfilled, onrejected),
		where: () => chain,
	};
	return chain;
}

function createNotificationTestApp() {
	return new Hono<AppEnv>()
		.use("*", async (c, next) => {
			c.set("user", {
				email: "owner@example.com",
				id: "user_owner",
				name: "Owner",
			} as never);
			c.set("session", {
				activeOrganizationId: "org_1",
				id: "sess_1",
				userId: "user_owner",
			} as never);
			await next();
		})
		.route("/notifications", notificationRoutes);
}

describe("organization ownership transfer service", () => {
	afterEach(() => {
		mock.restore();
	});

	test("rejects self-transfer before database transaction", async () => {
		await expect(
			transferOwnership({
				currentOwnerUserId: "user_1",
				newOwnerUserId: "user_1",
				organizationId: "org_1",
			})
		).rejects.toThrow("Target user is already the organization owner");
	});

	test("rejects transfer when requester is not an owner", async () => {
		spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			const txMock = {
				select: () =>
					createQueryChain([
						{ id: "mem_1", role: "admin", userId: "user_actor" },
					]),
			};
			return await callback(txMock);
		}) as never);

		await expect(
			transferOwnership({
				currentOwnerUserId: "user_actor",
				newOwnerUserId: "user_target",
				organizationId: "org_1",
			})
		).rejects.toThrow("Only the organization owner can transfer ownership");
	});

	test("rejects transfer to non-admin member", async () => {
		spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			const txMock = {
				select: () =>
					createQueryChain([
						{ id: "mem_owner", role: "owner", userId: "user_owner" },
						{ id: "mem_target", role: "member", userId: "user_target" },
					]),
			};
			return await callback(txMock);
		}) as never);

		await expect(
			transferOwnership({
				currentOwnerUserId: "user_owner",
				newOwnerUserId: "user_target",
				organizationId: "org_1",
			})
		).rejects.toThrow(
			"Ownership can only be transferred to an active organization admin"
		);
	});

	test("promotes active admin to owner and demotes current owner atomically", async () => {
		const appliedRoles: Array<{ id: string; role: string }> = [];
		let updateCount = 0;

		spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			const txMock = {
				select: () =>
					createQueryChain([
						{ id: "mem_owner", role: "owner", userId: "user_owner" },
						{ id: "mem_admin", role: "admin", userId: "user_admin" },
					]),
				update: () => ({
					set: (vals: { role: string }) => ({
						where: () => ({
							returning: () => {
								updateCount += 1;
								if (updateCount === 1) {
									appliedRoles.push({ id: "promoted", role: vals.role });
									return Promise.resolve([{ userId: "user_admin" }]);
								}
								appliedRoles.push({ id: "demoted", role: vals.role });
								return Promise.resolve([{ userId: "user_owner" }]);
							},
						}),
					}),
				}),
			};
			return await callback(txMock);
		}) as never);

		const result = await transferOwnership({
			currentOwnerUserId: "user_owner",
			newOwnerUserId: "user_admin",
			organizationId: "org_1",
		});

		expect(result).toEqual({
			newOwnerUserId: "user_admin",
			organizationId: "org_1",
			previousOwnerUserId: "user_owner",
		});
		expect(appliedRoles).toEqual([
			{ id: "promoted", role: "owner" },
			{ id: "demoted", role: "admin" },
		]);
	});
});

describe("notification routes and fan-out controls", () => {
	afterEach(() => {
		mock.restore();
	});

	test("rejects non-UUID notification ID before invoking service", async () => {
		const markSpy = spyOn(notificationService, "markAsRead");
		const app = createNotificationTestApp();

		const res = await app.request("/notifications/not-a-uuid/read", {
			method: "PATCH",
		});

		expect(res.status).toBe(400);
		expect(markSpy).not.toHaveBeenCalled();
	});

	test("lists paginated notifications with validated limit/offset params", async () => {
		const getSpy = spyOn(
			notificationService,
			"getUserNotifications"
		).mockResolvedValue({
			items: [],
			pagination: {
				hasMore: true,
				limit: 10,
				offset: 20,
				total: 35,
			},
			unreadCount: 4,
		});

		const app = createNotificationTestApp();
		const res = await app.request(
			"/notifications?limit=10&offset=20&unreadOnly=true"
		);

		expect(res.status).toBe(200);
		expect(getSpy).toHaveBeenCalledWith("user_owner", {
			limit: 10,
			offset: 20,
			unreadOnly: "true",
		});
	});

	test("returns 404 when markAsRead finds no matching user-owned row", async () => {
		spyOn(notificationService, "markAsRead").mockResolvedValue(null);
		const app = createNotificationTestApp();

		const res = await app.request(
			"/notifications/11111111-1111-4111-8111-111111111111/read",
			{ method: "PATCH" }
		);

		expect(res.status).toBe(404);
	});

	test("validates preference category and Web Push HTTPS subscription URLs", async () => {
		const saveSpy = spyOn(
			notificationService,
			"savePushSubscription"
		).mockResolvedValue({ id: "sub_1" } as never);
		const app = createNotificationTestApp();

		const badPrefRes = await app.request("/notifications/preferences", {
			body: JSON.stringify({
				category: "invalid_category",
				channel: "email",
				enabled: true,
			}),
			headers: { "content-type": "application/json" },
			method: "PATCH",
		});
		expect(badPrefRes.status).toBe(400);

		const validPushRes = await app.request("/notifications/push/subscribe", {
			body: JSON.stringify({
				endpoint: "https://push.example.com/v1/abc",
				keys: {
					auth: "auth-token",
					p256dh: "public-key",
				},
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(validPushRes.status).toBe(201);
		expect(saveSpy).toHaveBeenCalledTimes(1);

		const ssrfEndpoints = [
			"http://push.example.com/v1/abc",
			"https://localhost/push",
			"https://127.0.0.1/push",
			"https://169.254.169.254/latest/meta-data",
			"https://[::1]/push",
			"https://user:pass@push.example.com/v1/abc",
			"https://push.example.com:8443/v1/abc",
			"https://push.internal/v1/abc",
		];

		const rejectedResponses = await Promise.all(
			ssrfEndpoints.map((endpoint) =>
				app.request("/notifications/push/subscribe", {
					body: JSON.stringify({
						endpoint,
						keys: { auth: "auth-token", p256dh: "public-key" },
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				})
			)
		);
		for (const rejected of rejectedResponses) {
			expect(rejected.status).toBe(400);
		}
		expect(saveSpy).toHaveBeenCalledTimes(1);
	});

	test("savePushSubscription rejects hostnames resolving to private or metadata IPs", async () => {
		spyOn(pushEndpointResolver, "lookup").mockResolvedValueOnce([
			{ address: "169.254.169.254", family: 4 },
		]);

		await expect(
			notificationService.savePushSubscription("user_1", {
				endpoint: "https://rebind.example.com/v1/sub",
				keys: { auth: "auth-token", p256dh: "public-key" },
			})
		).rejects.toThrow("restricted network address");

		spyOn(pushEndpointResolver, "lookup").mockResolvedValueOnce([
			{ address: "10.0.0.5", family: 4 },
		]);

		await expect(
			notificationService.savePushSubscription("user_1", {
				endpoint: "https://internal-dns.example.com/v1/sub",
				keys: { auth: "auth-token", p256dh: "public-key" },
			})
		).rejects.toMatchObject({
			code: "BLOCKED_PUSH_ENDPOINT",
			field: "endpoint",
			path: ["endpoint"],
		});
	});

	test("updateOrganizationSchema restricts logo to https://, /api/, empty, or null and transfer-ownership requires owner role", async () => {
		expect(
			updateOrganizationSchema.safeParse({
				logo: "https://cdn.example.com/a.png",
			}).success
		).toBe(true);
		expect(
			updateOrganizationSchema.safeParse({ logo: "/api/storage/files/123" })
				.success
		).toBe(true);
		expect(updateOrganizationSchema.safeParse({ logo: "" }).success).toBe(true);
		expect(updateOrganizationSchema.safeParse({ logo: null }).success).toBe(
			true
		);

		expect(
			updateOrganizationSchema.safeParse({ logo: "javascript:alert(1)" })
				.success
		).toBe(false);
		expect(
			updateOrganizationSchema.safeParse({
				logo: "http://insecure.example.com/a.png",
			}).success
		).toBe(false);
		expect(
			updateOrganizationSchema.safeParse({ logo: "//evil.example.com/a.png" })
				.success
		).toBe(false);

		const orgApp = new Hono<AppEnv>()
			.use("*", async (c, next) => {
				c.set("user", {
					email: "admin@example.com",
					id: "user_admin",
					name: "Admin",
				} as never);
				c.set("session", {
					activeOrganizationId: "org_1",
					id: "sess_1",
					userId: "user_admin",
				} as never);
				await next();
			})
			.route("/organizations", organizationRoutes);

		spyOn(db, "select").mockImplementation((() =>
			createQueryChain([{ role: "admin" }])) as never);

		const res = await orgApp.request("/organizations/transfer-ownership", {
			body: JSON.stringify({ newOwnerUserId: "user_other" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(res.status).toBe(403);
	});

	test("sendToOrganizationAdmins deduplicates and fans out to owners and roles with notification:manage", async () => {
		let selectCall = 0;
		spyOn(db, "select").mockImplementation((() => {
			selectCall += 1;
			if (selectCall === 1) {
				return createQueryChain([
					{ role: "owner", userId: "user_1" },
					{ role: "admin, member", userId: "user_2" },
					{ role: "admin", userId: "user_1" },
					{ role: "ops-lead", userId: "user_3" },
					{ role: "viewer", userId: "user_4" },
				]);
			}
			return createQueryChain([
				{
					permission: JSON.stringify({ notification: ["read", "manage"] }),
					role: "ops-lead",
				},
			]);
		}) as never);

		const addBulkSpy = spyOn(notificationQueue, "addBulk").mockResolvedValue(
			[] as never
		);

		await notificationService.sendToOrganizationAdmins("org_1", {
			category: "security",
			content: "Ownership changed",
			title: "Security Notice",
			type: "ownership_transfer",
		});

		expect(addBulkSpy).toHaveBeenCalledTimes(1);
		const jobs = addBulkSpy.mock.calls[0]?.[0] as Array<{
			data: { organizationId?: string; userId: string };
		}>;
		expect(jobs.map((j) => j.data.userId)).toEqual([
			"user_1",
			"user_2",
			"user_3",
		]);
		expect(jobs.every((j) => j.data.organizationId === "org_1")).toBe(true);
	});

	test("hasOrgPermission enforces Better Auth dynamic RBAC and caches repeated checks", async () => {
		const permApp = new Hono<AppEnv>()
			.use("*", async (c, next) => {
				c.set("user", { id: "user_1" } as never);
				c.set("session", { activeOrganizationId: "org_1" } as never);
				await next();
			})
			.get(
				"/protected",
				hasOrgPermission("storage:read"),
				hasOrgPermission("storage:read"),
				(c) => c.json({ ok: true })
			);

		const permSpy = spyOn(auth.api, "hasPermission").mockResolvedValue({
			error: null,
			success: true,
		});
		const allowedRes = await permApp.request("/protected");
		expect(allowedRes.status).toBe(200);
		expect(permSpy).toHaveBeenCalledTimes(1);

		permSpy.mockResolvedValueOnce({ error: null, success: false });
		const deniedRes = await permApp.request("/protected");
		expect(deniedRes.status).toBe(403);
	});
});
