import { describe, expect, test } from "bun:test";
import { createApp } from "../../lib/create-hono-app";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../lib/errors";
import { isActiveUserBan } from "../../middleware/auth";
import { authRoutes } from "../auth/route";
import type { AuditRepository } from "./audit/repository";
import type {
	AdminOrganizationListItem,
	AdminOrganizationsRepository,
} from "./organizations/repository";
import {
	listAdminOrganizationsQuerySchema,
	MAX_STORAGE_LIMIT_BYTES,
	MIN_STORAGE_LIMIT_BYTES,
	updateStorageLimitBodySchema,
} from "./organizations/schema";
import { createAdminOrganizationsService } from "./organizations/service";
import type { AdminOverviewRepository } from "./overview/repository";
import { createAdminOverviewService } from "./overview/service";
import { adminRoutes } from "./route";
import {
	type AdminSystemDeps,
	createAdminSystemService,
} from "./system/service";
import type {
	AdminUserMutationTx,
	AdminUserRecord,
	AdminUsersRepository,
} from "./users/repository";
import {
	banUserBodySchema,
	listAdminUsersQuerySchema,
	updateUserRoleBodySchema,
} from "./users/schema";
import { createAdminUsersService } from "./users/service";

function createFakeUsersRepository(
	initialUsers: AdminUserRecord[]
): AdminUsersRepository {
	const users = new Map(initialUsers.map((entry) => [entry.id, { ...entry }]));
	const sessionsByUser = new Map<string, string[]>([
		["usr_admin_1", ["sess_admin_current"]],
		["usr_member", ["sess_1", "sess_2"]],
	]);

	const txAdapter: AdminUserMutationTx = {
		banUser({ banExpires, banReason, userId }) {
			const record = users.get(userId);
			if (!record) {
				return Promise.resolve(null);
			}
			const updated: AdminUserRecord = {
				...record,
				banExpires,
				banned: true,
				banReason,
			};
			users.set(userId, updated);
			const revokedTokens = sessionsByUser.get(userId) ?? [];
			sessionsByUser.set(userId, []);
			return Promise.resolve({ revokedTokens, updated });
		},
		countActivePlatformAdmins() {
			let total = 0;
			for (const entry of users.values()) {
				if (entry.role === "admin" && !isActiveUserBan(entry)) {
					total += 1;
				}
			}
			return Promise.resolve(total);
		},
		findUserById(userId) {
			return Promise.resolve(users.get(userId) ?? null);
		},
		updateUserRole(userId, role) {
			const record = users.get(userId);
			if (!record) {
				return Promise.resolve(null);
			}
			const updated: AdminUserRecord = { ...record, role };
			users.set(userId, updated);
			return Promise.resolve({
				activeTokens: sessionsByUser.get(userId) ?? [],
				updated,
			});
		},
	};

	return {
		findUserById(userId) {
			return Promise.resolve(users.get(userId) ?? null);
		},
		invalidateUserSessionsCache() {
			return Promise.resolve();
		},
		listUserMemberships() {
			return Promise.resolve([]);
		},
		listUsers({ limit, offset }) {
			const all = Array.from(users.values()).map((entry) => ({
				activeSessionCount: sessionsByUser.get(entry.id)?.length ?? 0,
				banExpires: entry.banExpires,
				banned: isActiveUserBan(entry),
				banReason: entry.banReason,
				createdAt: entry.createdAt,
				email: entry.email,
				emailVerified: entry.emailVerified,
				id: entry.id,
				image: entry.image,
				name: entry.name,
				organizationCount: 0,
				role: entry.role,
				twoFactorEnabled: Boolean(entry.twoFactorEnabled),
			}));
			return Promise.resolve({
				items: all.slice(offset, offset + limit),
				total: all.length,
			});
		},
		listUserSessions(userId) {
			const ids = sessionsByUser.get(userId) ?? [];
			return Promise.resolve(
				ids.map((id) => ({
					activeOrganizationId: null,
					createdAt: new Date("2026-11-26T10:00:00.000Z"),
					expiresAt: new Date("2026-12-03T10:00:00.000Z"),
					id,
					impersonatedBy: null,
					ipAddress: "127.0.0.1",
					userAgent: "test-agent",
				}))
			);
		},
		revokeAllUserSessions(userId) {
			const count = sessionsByUser.get(userId)?.length ?? 0;
			sessionsByUser.set(userId, []);
			return Promise.resolve(count);
		},
		revokeUserSession(userId, sessionId) {
			const current = sessionsByUser.get(userId) ?? [];
			if (!current.includes(sessionId)) {
				return Promise.resolve(false);
			}
			sessionsByUser.set(
				userId,
				current.filter((id) => id !== sessionId)
			);
			return Promise.resolve(true);
		},
		unbanUser(userId) {
			const record = users.get(userId);
			if (!record) {
				return Promise.resolve(null);
			}
			const updated: AdminUserRecord = {
				...record,
				banExpires: null,
				banned: false,
				banReason: null,
			};
			users.set(userId, updated);
			return Promise.resolve(updated);
		},
		withAdminMutationLock(fn) {
			return fn(txAdapter);
		},
	};
}

describe("admin backoffice router & Better Auth admin lockdown", () => {
	test("enforces authentication on every mounted backoffice endpoint", async () => {
		const app = createApp().route("/api/admin", adminRoutes);

		const endpoints: Array<{ method: string; path: string }> = [
			{ method: "GET", path: "/api/admin/overview" },
			{ method: "GET", path: "/api/admin/users" },
			{ method: "GET", path: "/api/admin/users/usr_1" },
			{ method: "PATCH", path: "/api/admin/users/usr_1/role" },
			{ method: "POST", path: "/api/admin/users/usr_1/ban" },
			{ method: "POST", path: "/api/admin/users/usr_1/unban" },
			{ method: "GET", path: "/api/admin/organizations" },
			{ method: "GET", path: "/api/admin/organizations/org_1" },
			{ method: "PATCH", path: "/api/admin/organizations/org_1/storage-limit" },
			{ method: "GET", path: "/api/admin/system" },
			{ method: "POST", path: "/api/admin/system/retention/run" },
		];

		const responses = await Promise.all(
			endpoints.map((endpoint) =>
				app.request(endpoint.path, { method: endpoint.method })
			)
		);
		for (const res of responses) {
			expect(res.status).toBe(401);
		}
	});

	test("blocks direct Better Auth /api/auth/admin/* bypass endpoints while preserving guarded impersonation", async () => {
		const app = createApp().route("/api/auth", authRoutes);

		const blockedEndpoints: Array<{ method: string; path: string }> = [
			{ method: "POST", path: "/api/auth/admin/set-role" },
			{ method: "POST", path: "/api/auth/admin/ban-user" },
			{ method: "POST", path: "/api/auth/admin/unban-user" },
			{ method: "POST", path: "/api/auth/admin/remove-user" },
			{ method: "POST", path: "/api/auth/admin/update-user" },
			{ method: "POST", path: "/api/auth/admin/set-user-password" },
			{ method: "GET", path: "/api/auth/admin/list-users" },
			{ method: "GET", path: "/api/auth/admin/impersonate-user" },
		];

		const responses = await Promise.all(
			blockedEndpoints.map((endpoint) =>
				app.request(endpoint.path, { method: endpoint.method })
			)
		);
		for (const res of responses) {
			expect(res.status).toBe(403);
		}

		// POST /api/auth/admin/impersonate-user remains guarded by authMiddleware + platformAdminMiddleware
		const unauthImpersonate = await app.request(
			"/api/auth/admin/impersonate-user",
			{
				body: JSON.stringify({ userId: "usr_member" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		expect(unauthImpersonate.status).toBe(401);
	});
});

describe("admin overview service", () => {
	test("computes 2FA adoption percentage and queries recent events without full count", async () => {
		const overviewRepo: AdminOverviewRepository = {
			getMetrics: () =>
				Promise.resolve({
					activeSessions: 12,
					auditEvents24h: 45,
					bannedUsers: 1,
					committedFiles: 88,
					platformAdmins: 2,
					securityEvents24h: 3,
					totalOrganizations: 5,
					totalStorageLimitBytes: 5 * 1024 * 1024 * 1024,
					totalStorageUsedBytes: 512 * 1024 * 1024,
					totalUsers: 20,
					twoFactorEnabledUsers: 13,
					verifiedUsers: 18,
				}),
		};
		let recentCalled = false;
		const auditRepo: AuditRepository = {
			listAuditLogs: () => Promise.reject(new Error("Should not call count")),
			listAuditLogsForExport: () => Promise.resolve([]),
			listRecentAuditLogs: () => {
				recentCalled = true;
				return Promise.resolve([]);
			},
		};

		const service = createAdminOverviewService(overviewRepo, auditRepo);
		const result = await service.getOverview();

		expect(recentCalled).toBe(true);
		expect(result.metrics.twoFactorAdoptionPercent).toBe(65);
		expect(result.metrics.securityEvents24h).toBe(3);
		expect(result.recentEvents).toEqual([]);
	});
});

describe("admin users service safety rails", () => {
	const baseUsers: AdminUserRecord[] = [
		{
			banExpires: null,
			banned: false,
			banReason: null,
			createdAt: new Date("2026-11-01T00:00:00.000Z"),
			email: "superadmin@acme.example",
			emailVerified: true,
			id: "usr_admin_1",
			image: null,
			name: "Primary Admin",
			role: "admin",
			twoFactorEnabled: true,
		},
		{
			banExpires: null,
			banned: false,
			banReason: null,
			createdAt: new Date("2026-11-02T00:00:00.000Z"),
			email: "member@acme.example",
			emailVerified: true,
			id: "usr_member",
			image: null,
			name: "Workspace Member",
			role: "user",
			twoFactorEnabled: false,
		},
		{
			banExpires: new Date("2020-01-01T00:00:00.000Z"),
			banned: true,
			banReason: "Expired temporary ban",
			createdAt: new Date("2026-11-03T00:00:00.000Z"),
			email: "expiredban@acme.example",
			emailVerified: true,
			id: "usr_expired_ban",
			image: null,
			name: "Expired Ban User",
			role: "user",
			twoFactorEnabled: false,
		},
	];

	test("prevents self-ban, banning admins, promoting banned users, and last-admin demotion", async () => {
		const repo = createFakeUsersRepository(baseUsers);
		const service = createAdminUsersService(repo);

		await expect(
			service.banUser({
				actorId: "usr_admin_1",
				body: banUserBodySchema.parse({ reason: "Self ban attempt" }),
				userId: "usr_admin_1",
			})
		).rejects.toBeInstanceOf(ValidationError);

		await expect(
			service.updateUserRole({
				actorId: "usr_admin_1",
				body: updateUserRoleBodySchema.parse({ role: "user" }),
				userId: "usr_admin_1",
			})
		).rejects.toBeInstanceOf(ValidationError);

		const promoted = await service.updateUserRole({
			actorId: "usr_admin_1",
			body: updateUserRoleBodySchema.parse({ role: "admin" }),
			userId: "usr_member",
		});
		expect(promoted.user.role).toBe("admin");
		expect(promoted.previousRole).toBe("user");

		await expect(
			service.banUser({
				actorId: "usr_admin_1",
				body: banUserBodySchema.parse({ reason: "Cannot ban peer admin" }),
				userId: "usr_member",
			})
		).rejects.toBeInstanceOf(ForbiddenError);

		const demoted = await service.updateUserRole({
			actorId: "usr_admin_1",
			body: updateUserRoleBodySchema.parse({ role: "user" }),
			userId: "usr_member",
		});
		expect(demoted.user.role).toBe("user");

		await expect(
			service.updateUserRole({
				actorId: "usr_other_actor",
				body: updateUserRoleBodySchema.parse({ role: "user" }),
				userId: "usr_admin_1",
			})
		).rejects.toBeInstanceOf(ConflictError);

		await service.banUser({
			actorId: "usr_admin_1",
			body: banUserBodySchema.parse({ reason: "Suspended" }),
			userId: "usr_member",
		});
		await expect(
			service.updateUserRole({
				actorId: "usr_admin_1",
				body: updateUserRoleBodySchema.parse({ role: "admin" }),
				userId: "usr_member",
			})
		).rejects.toBeInstanceOf(ConflictError);
	});

	test("handles expired bans cleanly and blocks revoking current own session", async () => {
		const repo = createFakeUsersRepository(baseUsers);
		const service = createAdminUsersService(repo);

		const list = await service.listUsers(
			listAdminUsersQuerySchema.parse({ limit: 10, page: 1 })
		);
		expect(list.items).toHaveLength(3);
		const expiredBanRow = list.items.find((u) => u.id === "usr_expired_ban");
		expect(expiredBanRow?.banned).toBe(false);

		const banned = await service.banUser({
			actorId: "usr_admin_1",
			body: banUserBodySchema.parse({
				expiresInDays: 7,
				reason: "Abuse detected",
			}),
			userId: "usr_member",
		});
		expect(banned.banned).toBe(true);
		expect(banned.banExpires).toBeInstanceOf(Date);

		const unbanned = await service.unbanUser("usr_member");
		expect(unbanned.banned).toBe(false);

		await expect(
			service.revokeUserSession({
				actorId: "usr_admin_1",
				currentSessionId: "sess_admin_current",
				sessionId: "sess_admin_current",
				userId: "usr_admin_1",
			})
		).rejects.toBeInstanceOf(ValidationError);

		await expect(
			service.revokeAllUserSessions({
				actorId: "usr_admin_1",
				userId: "usr_admin_1",
			})
		).rejects.toBeInstanceOf(ValidationError);

		await expect(
			service.revokeUserSession({
				actorId: "usr_admin_1",
				sessionId: "missing",
				userId: "usr_member",
			})
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("admin organizations service", () => {
	test("validates storage quota bounds, updates quotas, and maps FK 23503 to NotFoundError", async () => {
		expect(() =>
			updateStorageLimitBodySchema.parse({
				storageLimitBytes: MIN_STORAGE_LIMIT_BYTES - 1,
			})
		).toThrow();
		expect(() =>
			updateStorageLimitBodySchema.parse({
				storageLimitBytes: MAX_STORAGE_LIMIT_BYTES + 1,
			})
		).toThrow();

		const orgItem: AdminOrganizationListItem = {
			createdAt: new Date("2026-11-01T00:00:00.000Z"),
			currentUsage: 1024,
			fileCount: 2,
			id: "org_acme",
			logo: null,
			memberCount: 3,
			name: "Acme Corporation",
			pendingInvitationCount: 1,
			slug: "acme-corp",
			storageLimit: 1_073_741_824,
		};

		const repo: AdminOrganizationsRepository = {
			findOrganizationById: (id) =>
				Promise.resolve(
					id === "org_acme"
						? {
								createdAt: orgItem.createdAt,
								id: orgItem.id,
								logo: null,
								name: orgItem.name,
								slug: orgItem.slug,
							}
						: null
				),
			getOrganizationStorage: () =>
				Promise.resolve({
					currentUsage: orgItem.currentUsage,
					fileCount: orgItem.fileCount,
					storageLimit: orgItem.storageLimit,
					updatedAt: new Date(),
				}),
			listOrganizationInvitations: () => Promise.resolve([]),
			listOrganizationMembers: () => Promise.resolve([]),
			listOrganizations: () => Promise.resolve({ items: [orgItem], total: 1 }),
			upsertStorageLimit: (organizationId, storageLimitBytes) => {
				orgItem.storageLimit = storageLimitBytes;
				return Promise.resolve({
					currentUsage: orgItem.currentUsage,
					organizationId,
					storageLimit: storageLimitBytes,
					updatedAt: new Date(),
				});
			},
		};

		const service = createAdminOrganizationsService(repo);
		const listed = await service.listOrganizations(
			listAdminOrganizationsQuerySchema.parse({ limit: 25, page: 1 })
		);
		expect(listed.items).toHaveLength(1);

		const newQuota = 10 * 1024 * 1024 * 1024;
		const updated = await service.updateStorageLimit({
			body: updateStorageLimitBodySchema.parse({ storageLimitBytes: newQuota }),
			organizationId: "org_acme",
		});
		expect(updated.storageLimit).toBe(newQuota);

		const concurrentDeleteService = createAdminOrganizationsService({
			...repo,
			upsertStorageLimit: () => Promise.reject({ code: "23503" }),
		});
		await expect(
			concurrentDeleteService.updateStorageLimit({
				body: updateStorageLimitBodySchema.parse({
					storageLimitBytes: newQuota,
				}),
				organizationId: "org_acme",
			})
		).rejects.toBeInstanceOf(NotFoundError);

		await expect(
			service.getOrganizationDetail("org_missing")
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("admin system service", () => {
	test("reports dependency health, queue depths, and manual retention sweep rules", async () => {
		let enqueuedManual = false;
		const redisDeps: AdminSystemDeps = {
			checkDatabase: () => Promise.resolve(),
			checkRedis: () => Promise.resolve("PONG"),
			enqueueRetentionJob: (data) => {
				expect(data.triggeredBy).toBe("manual");
				enqueuedManual = true;
				return Promise.resolve({ id: "job_42" });
			},
			getQueueCounts: () =>
				Promise.resolve({
					active: 1,
					completed: 10,
					delayed: 0,
					failed: 0,
					waiting: 2,
				}),
			queueDriver: "redis",
			s3Bucket: "starter-bucket",
			s3Configured: true,
			s3Region: "us-east-1",
			s3UseIamRole: false,
		};

		const service = createAdminSystemService(redisDeps);
		const status = await service.getSystemStatus();
		expect(status.status).toBe("ok");
		expect(status.queues).toHaveLength(3);
		expect(status.queues[0]?.counts?.waiting).toBe(2);

		const sweep = await service.triggerRetentionSweep();
		expect(enqueuedManual).toBe(true);
		expect(sweep.jobId).toBe("job_42");
		expect(sweep.triggeredBy).toBe("manual");

		const inlineService = createAdminSystemService({
			...redisDeps,
			checkRedis: () => Promise.reject(new Error("Redis down")),
			queueDriver: "inline",
		});
		const degraded = await inlineService.getSystemStatus();
		expect(degraded.status).toBe("degraded");
		expect(degraded.queues[0]?.mode).toBe("inline");
		expect(degraded.queues[0]?.counts).toBeNull();

		await expect(inlineService.triggerRetentionSweep()).rejects.toBeInstanceOf(
			ValidationError
		);
	});
});
