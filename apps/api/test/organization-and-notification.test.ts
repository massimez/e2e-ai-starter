import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { db } from "@workspace/db";
import { Hono } from "hono";
import type { AppEnv } from "../src/lib/create-hono-app";
import { notificationQueue } from "../src/modules/notification/queue";
import { notificationRoutes } from "../src/modules/notification/route";
import { notificationService } from "../src/modules/notification/service";
import { transferOwnership } from "../src/modules/organization/service";
import { rolesService } from "../src/modules/roles/service";

function createQueryChain<T>(result: T) {
	const chain = {
		from: () => chain,
		limit: () => Promise.resolve(result),
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
			let selectCount = 0;
			const txMock = {
				select: () => {
					selectCount += 1;
					if (selectCount === 1) {
						return createQueryChain([
							{ id: "mem_owner", role: "owner", userId: "user_owner" },
						]);
					}
					return createQueryChain([
						{ id: "mem_target", role: "member", userId: "user_target" },
					]);
				},
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

		spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			let selectCount = 0;
			const txMock = {
				select: () => {
					selectCount += 1;
					if (selectCount === 1) {
						return createQueryChain([
							{ id: "mem_owner", role: "owner", userId: "user_owner" },
						]);
					}
					return createQueryChain([
						{ id: "mem_admin", role: "admin", userId: "user_admin" },
					]);
				},
				update: () => ({
					set: (vals: { role: string }) => ({
						where: () => ({
							returning: () => {
								appliedRoles.push({ id: "promoted", role: vals.role });
								return Promise.resolve([{ userId: "user_admin" }]);
							},
							// biome-ignore lint/suspicious/noThenProperty: Drizzle awaitable mock
							then: (resolve: (val: unknown) => void) => {
								appliedRoles.push({ id: "demoted", role: vals.role });
								return Promise.resolve(undefined).then(resolve);
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
	});

	test("sendToOrganizationAdmins deduplicates and fans out to owners and roles with notification:manage", async () => {
		spyOn(db, "select").mockImplementation((() =>
			createQueryChain([
				{ role: "owner", userId: "user_1" },
				{ role: "admin, member", userId: "user_2" },
				{ role: "admin", userId: "user_1" },
				{ role: "ops-lead", userId: "user_3" },
				{ role: "viewer", userId: "user_4" },
			])) as never);
		spyOn(rolesService, "getRoleSlugsWithPermission").mockResolvedValue([
			"admin",
			"ops-lead",
		]);

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
});
