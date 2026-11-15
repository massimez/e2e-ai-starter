import { lookup } from "node:dns/promises";
import { db } from "@workspace/db";
import {
	member,
	notification,
	notificationPreference,
	pushSubscription,
} from "@workspace/db/schema";
import { and, count, desc, eq } from "drizzle-orm";
import { parseMemberRoles } from "../../lib/auth/permissions";
import { ValidationError } from "../../lib/errors";
import {
	isBlockedIpAddress,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	type NotificationJobData,
	validatePushEndpointUrl,
} from "../../lib/queues";
import { rolesService } from "../roles/service";
import { enqueueNotification, enqueueNotificationsBulk } from "./queue";
import type {
	ListNotificationsQuery,
	PushSubscriptionInput,
	UpdatePreferenceInput,
} from "./schema";

export const pushEndpointResolver = {
	lookup: (hostname: string) => lookup(hostname, { all: true, verbatim: true }),
};

async function assertSafePushEndpoint(endpoint: string): Promise<void> {
	const validation = validatePushEndpointUrl(endpoint);
	if (!validation.ok) {
		throw new ValidationError(validation.reason, "INVALID_PUSH_ENDPOINT");
	}

	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await pushEndpointResolver.lookup(validation.url.hostname);
	} catch (error) {
		throw new ValidationError("Push endpoint hostname could not be resolved", {
			cause: error,
			field: "endpoint",
		});
	}

	if (
		addresses.length === 0 ||
		addresses.some((entry) => isBlockedIpAddress(entry.address))
	) {
		throw new ValidationError(
			"Push endpoint resolved to a restricted network address",
			"BLOCKED_PUSH_ENDPOINT"
		);
	}
}

export const notificationService = {
	async deletePushSubscription(userId: string, endpoint: string) {
		await db
			.delete(pushSubscription)
			.where(
				and(
					eq(pushSubscription.userId, userId),
					eq(pushSubscription.endpoint, endpoint)
				)
			);
		return { success: true };
	},

	async getPreferences(userId: string) {
		const existing = await db
			.select()
			.from(notificationPreference)
			.where(eq(notificationPreference.userId, userId));

		if (existing.length > 0) {
			return existing;
		}

		const defaults = NOTIFICATION_CATEGORIES.flatMap((category) =>
			NOTIFICATION_CHANNELS.map((channel) => ({
				category,
				channel,
				enabled: true,
				userId,
			}))
		);

		await db
			.insert(notificationPreference)
			.values(defaults)
			.onConflictDoNothing();

		return await db
			.select()
			.from(notificationPreference)
			.where(eq(notificationPreference.userId, userId));
	},

	async getUnreadCount(userId: string): Promise<number> {
		const [result] = await db
			.select({ unreadCount: count() })
			.from(notification)
			.where(
				and(eq(notification.userId, userId), eq(notification.isRead, false))
			);
		return result?.unreadCount ?? 0;
	},

	async getUserNotifications(userId: string, query: ListNotificationsQuery) {
		const conditions = [eq(notification.userId, userId)];
		if (query.unreadOnly === "true") {
			conditions.push(eq(notification.isRead, false));
		}

		const whereClause = and(...conditions);

		const [items, totalResult, unreadCount] = await Promise.all([
			db
				.select()
				.from(notification)
				.where(whereClause)
				.orderBy(desc(notification.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(notification).where(whereClause),
			this.getUnreadCount(userId),
		]);

		const total = totalResult[0]?.total ?? 0;

		return {
			items,
			pagination: {
				hasMore: query.offset + items.length < total,
				limit: query.limit,
				offset: query.offset,
				total,
			},
			unreadCount,
		};
	},

	async markAllAsRead(userId: string) {
		const now = new Date();
		await db
			.update(notification)
			.set({ isRead: true, readAt: now })
			.where(
				and(eq(notification.userId, userId), eq(notification.isRead, false))
			);
		return { success: true };
	},

	async markAsRead(userId: string, notificationId: string) {
		const now = new Date();
		const [updated] = await db
			.update(notification)
			.set({ isRead: true, readAt: now })
			.where(
				and(
					eq(notification.id, notificationId),
					eq(notification.userId, userId)
				)
			)
			.returning();
		return updated ?? null;
	},

	async savePushSubscription(userId: string, input: PushSubscriptionInput) {
		await assertSafePushEndpoint(input.endpoint);
		const now = new Date();
		const [sub] = await db
			.insert(pushSubscription)
			.values({
				endpoint: input.endpoint,
				keys: input.keys,
				updatedAt: now,
				userAgent: input.userAgent ?? null,
				userId,
			})
			.onConflictDoUpdate({
				set: {
					keys: input.keys,
					updatedAt: now,
					userAgent: input.userAgent ?? null,
				},
				target: [pushSubscription.userId, pushSubscription.endpoint],
			})
			.returning();
		return sub;
	},

	async send(payload: NotificationJobData) {
		await enqueueNotification(payload);
	},

	async sendToOrganizationAdmins(
		organizationId: string,
		payload: Omit<NotificationJobData, "userId">
	) {
		const [orgMembers, eligibleRoleSlugs] = await Promise.all([
			db
				.select({ role: member.role, userId: member.userId })
				.from(member)
				.where(eq(member.organizationId, organizationId)),
			rolesService.getRoleSlugsWithPermission(
				organizationId,
				"notification:manage"
			),
		]);

		const eligibleSet = new Set(eligibleRoleSlugs);
		const adminUserIds = new Set<string>();
		for (const orgMember of orgMembers) {
			const memberRoles = parseMemberRoles(orgMember.role).map((role) =>
				role.trim().toLowerCase()
			);
			if (
				memberRoles.includes("owner") ||
				memberRoles.some((role) => eligibleSet.has(role))
			) {
				adminUserIds.add(orgMember.userId);
			}
		}

		await enqueueNotificationsBulk(
			Array.from(adminUserIds, (userId) => ({
				data: {
					...payload,
					organizationId: payload.organizationId ?? organizationId,
					userId,
				},
			}))
		);
	},

	async updatePreference(userId: string, input: UpdatePreferenceInput) {
		const now = new Date();
		const [updated] = await db
			.insert(notificationPreference)
			.values({
				category: input.category,
				channel: input.channel,
				enabled: input.enabled,
				updatedAt: now,
				userId,
			})
			.onConflictDoUpdate({
				set: {
					enabled: input.enabled,
					updatedAt: now,
				},
				target: [
					notificationPreference.userId,
					notificationPreference.category,
					notificationPreference.channel,
				],
			})
			.returning();
		return updated;
	},
};
