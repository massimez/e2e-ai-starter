import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { auth } from "../src/lib/auth";
import { createOrganizationLifecycleHooks } from "../src/lib/auth/organization-lifecycle";
import { ac, roles } from "../src/lib/auth/permissions";
import {
	type DefaultOrganizationStore,
	enforceActiveOnOrganizationCreateBody,
	healDefaultOrganizationAfterMembershipLoss,
	persistDefaultOrganizationOnCreate,
	resolveSessionOrganizationOnConnect,
	syncDefaultOrganizationOnSessionActivation,
} from "../src/modules/organization/default-organization";

interface MemoryUserRecord {
	createdAt?: Date;
	defaultOrganizationId?: string | null;
	email: string;
	id: string;
	[key: string]: unknown;
}

interface MemoryMemberRecord {
	createdAt: Date | string;
	id: string;
	organizationId: string;
	role: string;
	userId: string;
	[key: string]: unknown;
}

interface MemoryDb {
	account: Record<string, unknown>[];
	invitation: Record<string, unknown>[];
	member: MemoryMemberRecord[];
	organization: Record<string, unknown>[];
	session: Record<string, unknown>[];
	user: MemoryUserRecord[];
	verification: Record<string, unknown>[];
}

function createInMemoryDefaultOrganizationStore(
	memoryDb: MemoryDb
): DefaultOrganizationStore {
	return {
		findEarliestMemberOrganizationId(userId: string) {
			const memberships = memoryDb.member
				.filter((m) => m.userId === userId)
				.sort((a, b) => {
					const aTime = new Date(a.createdAt).getTime();
					const bTime = new Date(b.createdAt).getTime();
					if (aTime !== bTime) {
						return aTime - bTime;
					}
					return a.id.localeCompare(b.id);
				});

			return Promise.resolve(memberships[0]?.organizationId ?? null);
		},

		getUserDefaultOrganizationId(userId: string) {
			const found = memoryDb.user.find((u) => u.id === userId);
			return Promise.resolve(found?.defaultOrganizationId ?? null);
		},

		isUserMemberOfOrganization(userId: string, organizationId: string) {
			return Promise.resolve(
				memoryDb.member.some(
					(m) => m.userId === userId && m.organizationId === organizationId
				)
			);
		},

		setUserDefaultOrganizationId(
			userId: string,
			organizationId: string | null
		) {
			const found = memoryDb.user.find((u) => u.id === userId);
			if (found) {
				found.defaultOrganizationId = organizationId;
			}
			return Promise.resolve();
		},
	};
}

function extractSessionCookie(headers: Headers): string {
	const setCookies = headers.getSetCookie?.() ?? [];
	const cookies: string[] = [];
	for (const entry of setCookies) {
		const [pair] = entry.split(";");
		if (pair) {
			cookies.push(pair);
		}
	}
	if (cookies.length === 0) {
		const fallback = headers.get("set-cookie");
		if (fallback) {
			const [pair] = fallback.split(";");
			if (pair) {
				cookies.push(pair);
			}
		}
	}
	return cookies.join("; ");
}

function createTestAuthInstance(options?: {
	sessionConfig?: { expiresIn: number; updateAge: number };
	wrapStore?: (store: DefaultOrganizationStore) => DefaultOrganizationStore;
}) {
	const memoryDb: MemoryDb = {
		account: [],
		invitation: [],
		member: [],
		organization: [],
		session: [],
		user: [],
		verification: [],
	};

	const baseStore = createInMemoryDefaultOrganizationStore(memoryDb);
	const store = options?.wrapStore ? options.wrapStore(baseStore) : baseStore;
	const orgLifecycle = createOrganizationLifecycleHooks(store);

	const testAuth = betterAuth({
		baseURL: "http://localhost:3001",
		database: memoryAdapter(memoryDb),
		databaseHooks: {
			session: orgLifecycle.sessionDatabaseHooks,
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		hooks: {
			after: orgLifecycle.after,
			before: orgLifecycle.before,
		},
		logger: {
			disabled: true,
		},
		plugins: [
			organization({
				ac,
				allowUserToCreateOrganization: true,
				organizationHooks: orgLifecycle.organizationHooks,
				organizationLimit: 5,
				roles,
			}),
		],
		secret: "test-secret-with-at-least-thirty-two-characters-1234",
		...(options?.sessionConfig ? { session: options.sessionConfig } : {}),
	});

	return { memoryDb, store, testAuth };
}

describe("drizzle schema alignment with better-auth", () => {
	test("user.defaultOrganizationId column introduces zero better-auth schema problems", async () => {
		const ctx = await auth.$context;
		await expect(Promise.resolve(ctx.checkSchema?.())).resolves.toBeUndefined();
	});
});

describe("default organization service helpers", () => {
	test("enforceActiveOnOrganizationCreateBody forces keepCurrentActiveOrganization to false", () => {
		expect(
			enforceActiveOnOrganizationCreateBody({
				keepCurrentActiveOrganization: true,
				name: "Acme",
				slug: "acme",
			})
		).toEqual({
			keepCurrentActiveOrganization: false,
			name: "Acme",
			slug: "acme",
		});

		expect(enforceActiveOnOrganizationCreateBody(null)).toBeUndefined();
		expect(enforceActiveOnOrganizationCreateBody(["invalid"])).toBeUndefined();
	});

	test("resolves persisted default org when membership is valid and heals stale defaults", async () => {
		const memoryDb: MemoryDb = {
			account: [],
			invitation: [],
			member: [
				{
					createdAt: new Date("2026-01-01T00:00:00Z"),
					id: "mem_1",
					organizationId: "org_1",
					role: "owner",
					userId: "user_1",
				},
				{
					createdAt: new Date("2026-01-02T00:00:00Z"),
					id: "mem_2",
					organizationId: "org_2",
					role: "member",
					userId: "user_1",
				},
			],
			organization: [],
			session: [],
			user: [
				{
					defaultOrganizationId: "org_2",
					email: "u@example.com",
					id: "user_1",
				},
			],
			verification: [],
		};

		const store = createInMemoryDefaultOrganizationStore(memoryDb);

		expect(
			await resolveSessionOrganizationOnConnect({ userId: "user_1" }, store)
		).toBe("org_2");

		// Remove user from org_2 -> should heal to earliest remaining org_1
		memoryDb.member = memoryDb.member.filter(
			(m) => m.organizationId !== "org_2"
		);
		expect(
			await healDefaultOrganizationAfterMembershipLoss(
				{ lostOrganizationId: "org_2", userId: "user_1" },
				store
			)
		).toBe("org_1");
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe("org_1");

		// Explicit null activation keeps default remembered
		await persistDefaultOrganizationOnCreate(
			{ organizationId: "org_2", userId: "user_1" },
			store
		);
		await syncDefaultOrganizationOnSessionActivation(
			{ activeOrganizationId: null, userId: "user_1" },
			store
		);
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe("org_2");
	});
});

describe("better-auth organization lifecycle integration", () => {
	test("enforces active+default on create, updates default on switch, keeps remembered on null reset, and heals on delete/leave/remove", async () => {
		const { memoryDb, testAuth } = createTestAuthInstance();

		const signUpRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-up/email", {
				body: JSON.stringify({
					email: "alice@example.com",
					name: "Alice",
					password: "Password123!",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
		);
		expect(signUpRes.status).toBe(200);
		let cookie = extractSessionCookie(signUpRes.headers);

		// Initial session has 0 organizations -> activeOrganizationId is null
		const initialSessionRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/get-session", {
				headers: { cookie },
			})
		);
		const initialSession = (await initialSessionRes.json()) as {
			session: { activeOrganizationId: string | null };
		};
		expect(initialSession.session.activeOrganizationId).toBeNull();

		// Creating Org 1 even with keepCurrentActiveOrganization=true forces active + default
		const createOrg1Res = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/create", {
				body: JSON.stringify({
					keepCurrentActiveOrganization: true,
					name: "Alpha Workspace",
					slug: "alpha-workspace",
				}),
				headers: {
					"content-type": "application/json",
					cookie,
				},
				method: "POST",
			})
		);
		expect(createOrg1Res.status).toBe(200);
		const org1 = (await createOrg1Res.json()) as { id: string };

		const afterOrg1Session = (await (
			await testAuth.handler(
				new Request("http://localhost:3001/api/auth/get-session", {
					headers: { cookie },
				})
			)
		).json()) as {
			session: { activeOrganizationId: string | null };
			user: { id: string };
		};
		expect(afterOrg1Session.session.activeOrganizationId).toBe(org1.id);
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe(org1.id);

		// Creating Org 2 also forces Org 2 to be active + default
		const createOrg2Res = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/create", {
				body: JSON.stringify({
					keepCurrentActiveOrganization: true,
					name: "Beta Workspace",
					slug: "beta-workspace",
				}),
				headers: {
					"content-type": "application/json",
					cookie,
				},
				method: "POST",
			})
		);
		expect(createOrg2Res.status).toBe(200);
		const org2 = (await createOrg2Res.json()) as { id: string };

		const afterOrg2Session = (await (
			await testAuth.handler(
				new Request("http://localhost:3001/api/auth/get-session", {
					headers: { cookie },
				})
			)
		).json()) as { session: { activeOrganizationId: string | null } };
		expect(afterOrg2Session.session.activeOrganizationId).toBe(org2.id);
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe(org2.id);

		// Sign out & reconnect -> defaults to Org 2 automatically
		await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-out", {
				body: JSON.stringify({}),
				headers: {
					"content-type": "application/json",
					cookie,
				},
				method: "POST",
			})
		);

		const signInRes1 = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-in/email", {
				body: JSON.stringify({
					email: "alice@example.com",
					password: "Password123!",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
		);
		expect(signInRes1.status).toBe(200);
		cookie = extractSessionCookie(signInRes1.headers);

		const reconnect1 = (await (
			await testAuth.handler(
				new Request("http://localhost:3001/api/auth/get-session", {
					headers: { cookie },
				})
			)
		).json()) as { session: { activeOrganizationId: string | null } };
		expect(reconnect1.session.activeOrganizationId).toBe(org2.id);

		// Switching to Org 1 updates defaultOrganizationId to Org 1
		const switchToOrg1Res = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/set-active", {
				body: JSON.stringify({ organizationId: org1.id }),
				headers: {
					"content-type": "application/json",
					cookie,
				},
				method: "POST",
			})
		);
		expect(switchToOrg1Res.status).toBe(200);
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe(org1.id);

		// Explicitly clearing activeOrganizationId preserves defaultOrganizationId (Org 1)
		const clearActiveRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/set-active", {
				body: JSON.stringify({ organizationId: null }),
				headers: {
					"content-type": "application/json",
					cookie,
				},
				method: "POST",
			})
		);
		expect(clearActiveRes.status).toBe(200);
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe(org1.id);

		const afterClear = (await (
			await testAuth.handler(
				new Request("http://localhost:3001/api/auth/get-session", {
					headers: { cookie },
				})
			)
		).json()) as { session: { activeOrganizationId: string | null } };
		expect(afterClear.session.activeOrganizationId).toBeNull();

		// Reconnect again -> restores remembered default (Org 1)
		const signInRes2 = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-in/email", {
				body: JSON.stringify({
					email: "alice@example.com",
					password: "Password123!",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
		);
		cookie = extractSessionCookie(signInRes2.headers);

		const reconnect2 = (await (
			await testAuth.handler(
				new Request("http://localhost:3001/api/auth/get-session", {
					headers: { cookie },
				})
			)
		).json()) as { session: { activeOrganizationId: string | null } };
		expect(reconnect2.session.activeOrganizationId).toBe(org1.id);

		// Delete Org 1 -> heals default + active session to remaining Org 2
		const deleteOrg1Res = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/delete", {
				body: JSON.stringify({ organizationId: org1.id }),
				headers: {
					"content-type": "application/json",
					cookie,
				},
				method: "POST",
			})
		);
		expect(deleteOrg1Res.status).toBe(200);
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe(org2.id);

		const afterDeleteOrg1 = (await (
			await testAuth.handler(
				new Request("http://localhost:3001/api/auth/get-session", {
					headers: { cookie },
				})
			)
		).json()) as { session: { activeOrganizationId: string | null } };
		expect(afterDeleteOrg1.session.activeOrganizationId).toBe(org2.id);

		// Delete last org (Org 2) -> heals default + active session to null
		const deleteOrg2Res = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/delete", {
				body: JSON.stringify({ organizationId: org2.id }),
				headers: {
					"content-type": "application/json",
					cookie,
				},
				method: "POST",
			})
		);
		expect(deleteOrg2Res.status).toBe(200);
		expect(memoryDb.user[0]?.defaultOrganizationId).toBeNull();
	});

	test("leave and member removal heal defaultOrganizationId when membership is lost", async () => {
		const { memoryDb, testAuth } = createTestAuthInstance();

		// Owner Alice creates Org A & Org B, invites Bob to Org A and Org B
		const aliceSignUp = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-up/email", {
				body: JSON.stringify({
					email: "alice2@example.com",
					name: "Alice Two",
					password: "Password123!",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
		);
		const aliceCookie = extractSessionCookie(aliceSignUp.headers);

		const orgARes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/create", {
				body: JSON.stringify({ name: "Org A", slug: "org-a-test" }),
				headers: { "content-type": "application/json", cookie: aliceCookie },
				method: "POST",
			})
		);
		const orgA = (await orgARes.json()) as { id: string };

		const orgBRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/create", {
				body: JSON.stringify({ name: "Org B", slug: "org-b-test" }),
				headers: { "content-type": "application/json", cookie: aliceCookie },
				method: "POST",
			})
		);
		const orgB = (await orgBRes.json()) as { id: string };

		const bobSignUp = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-up/email", {
				body: JSON.stringify({
					email: "bob@example.com",
					name: "Bob",
					password: "Password123!",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
		);
		const bobCookie = extractSessionCookie(bobSignUp.headers);
		const bobUser = memoryDb.user.find((u) => u.email === "bob@example.com");
		expect(bobUser).toBeDefined();

		// Invite Bob to Org A then Org B via invitations
		const invARes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/invite-member", {
				body: JSON.stringify({
					email: "bob@example.com",
					organizationId: orgA.id,
					role: "member",
				}),
				headers: { "content-type": "application/json", cookie: aliceCookie },
				method: "POST",
			})
		);
		const invA = (await invARes.json()) as { id: string };

		const invBRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/invite-member", {
				body: JSON.stringify({
					email: "bob@example.com",
					organizationId: orgB.id,
					role: "member",
				}),
				headers: { "content-type": "application/json", cookie: aliceCookie },
				method: "POST",
			})
		);
		const invB = (await invBRes.json()) as { id: string };

		// Bob accepts Org A then Org B (accept-invitation activates each -> Org B becomes default)
		await testAuth.handler(
			new Request(
				"http://localhost:3001/api/auth/organization/accept-invitation",
				{
					body: JSON.stringify({ invitationId: invA.id }),
					headers: { "content-type": "application/json", cookie: bobCookie },
					method: "POST",
				}
			)
		);
		await testAuth.handler(
			new Request(
				"http://localhost:3001/api/auth/organization/accept-invitation",
				{
					body: JSON.stringify({ invitationId: invB.id }),
					headers: { "content-type": "application/json", cookie: bobCookie },
					method: "POST",
				}
			)
		);
		expect(bobUser?.defaultOrganizationId).toBe(orgB.id);

		// Bob leaves Org B -> heals Bob's default & active org back to Org A
		const leaveRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/leave", {
				body: JSON.stringify({ organizationId: orgB.id }),
				headers: { "content-type": "application/json", cookie: bobCookie },
				method: "POST",
			})
		);
		expect(leaveRes.status).toBe(200);
		expect(bobUser?.defaultOrganizationId).toBe(orgA.id);

		const bobAfterLeave = (await (
			await testAuth.handler(
				new Request("http://localhost:3001/api/auth/get-session", {
					headers: { cookie: bobCookie },
				})
			)
		).json()) as { session: { activeOrganizationId: string | null } };
		expect(bobAfterLeave.session.activeOrganizationId).toBe(orgA.id);

		// Alice removes Bob from Org A -> heals Bob's default to null
		const bobMembershipA = memoryDb.member.find(
			(m) => m.userId === bobUser?.id && m.organizationId === orgA.id
		);
		expect(bobMembershipA).toBeDefined();

		const removeRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/remove-member", {
				body: JSON.stringify({
					memberIdOrEmail: bobMembershipA?.id,
					organizationId: orgA.id,
				}),
				headers: { "content-type": "application/json", cookie: aliceCookie },
				method: "POST",
			})
		);
		expect(removeRes.status).toBe(200);
		expect(bobUser?.defaultOrganizationId).toBeNull();
	});

	test("rolling session refreshes skip redundant default-organization queries", async () => {
		let storeCalls = 0;
		const { memoryDb, testAuth } = createTestAuthInstance({
			sessionConfig: { expiresIn: 600, updateAge: 60 },
			wrapStore: (base) => ({
				findEarliestMemberOrganizationId(userId) {
					storeCalls += 1;
					return base.findEarliestMemberOrganizationId(userId);
				},
				getUserDefaultOrganizationId(userId) {
					storeCalls += 1;
					return base.getUserDefaultOrganizationId(userId);
				},
				isUserMemberOfOrganization(userId, organizationId) {
					storeCalls += 1;
					return base.isUserMemberOfOrganization(userId, organizationId);
				},
				setUserDefaultOrganizationId(userId, organizationId) {
					storeCalls += 1;
					return base.setUserDefaultOrganizationId(userId, organizationId);
				},
			}),
		});

		const signUpRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-up/email", {
				body: JSON.stringify({
					email: "carol@example.com",
					name: "Carol",
					password: "Password123!",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
		);
		const cookie = extractSessionCookie(signUpRes.headers);

		const orgRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/create", {
				body: JSON.stringify({
					name: "Carol Org",
					slug: "carol-org",
				}),
				headers: { "content-type": "application/json", cookie },
				method: "POST",
			})
		);
		const org = (await orgRes.json()) as { id: string };
		expect(memoryDb.user[0]?.defaultOrganizationId).toBe(org.id);

		// Force the session inside the Better Auth rolling-refresh window
		const [sessionRow] = memoryDb.session;
		expect(sessionRow).toBeDefined();
		if (sessionRow) {
			sessionRow.expiresAt = new Date(Date.now() + 100_000);
		}

		storeCalls = 0;
		const refreshRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/get-session", {
				headers: { cookie },
			})
		);
		expect(refreshRes.status).toBe(200);
		expect(
			new Date(String(memoryDb.session[0]?.expiresAt)).getTime()
		).toBeGreaterThan(Date.now() + 500_000);
		expect(storeCalls).toBe(0);

		const setActiveRes = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/organization/set-active", {
				body: JSON.stringify({ organizationId: org.id }),
				headers: { "content-type": "application/json", cookie },
				method: "POST",
			})
		);
		expect(setActiveRes.status).toBe(200);
		expect(storeCalls).toBeGreaterThan(0);
	});
});
