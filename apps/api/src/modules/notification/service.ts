import { lookup } from "node:dns/promises";
import { db } from "@workspace/db";
import {
	member,
	notification,
	notificationPreference,
	organizationRole,
	pushSubscription,
} from "@workspace/db/schema";
import { resolveSafePushEndpoint } from "@workspace/shared/network";
import {
	type OrganizationRoleName,
	parseMemberRoles,
	roleAllows,
	SYSTEM_ROLE_SLUGS,
} from "@workspace/shared/permissions";
import {
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	type NotificationJobData,
} from "@workspace/shared/queues";
import { and, count, desc, eq } from "drizzle-orm";
import { ValidationError } from "../../lib/errors";
import { enqueueNotificationsBulk } from "./queue";
import type {
	ListNotificationsQuery,
	PushSubscriptionInput,
	UpdatePreferenceInput,
} from "./schema";

export const pushEndpointResolver = {
	lookup: (hostname: string) => lookup(hostname, { all: true, verbatim: true }),
};

async function assertSafePushEndpoint(endpoint: string): Promise<void> {
	const resolved = await resolveSafePushEndpoint(
		endpoint,
		pushEndpointResolver.lookup
	);
	if (!resolved.ok) {
		throw new ValidationError(resolved.reason, {
			...(resolved.cause === undefined ? {} : { cause: resolved.cause }),
			code: resolved.code,
			field: "endpoint",
		});
	}
}

const EXPECTED_PREFERENCE_COUNT =
	NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length;

function roleJsonAllows(
	rawPermissionJson: string,
	resource: string,
	action: string
): boolean {
	try {
		const parsed = JSON.parse(rawPermissionJson) as Record<
			string,
			readonly string[] | undefined
		>;
		return Boolean(parsed[resource]?.includes(action));
	} catch {
		return false;
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

		if (existing.length >= EXPECTED_PREFERENCE_COUNT) {
			return existing;
		}

		const existingKeys = new Set(
			existing.map((pref) => `${pref.category}:${pref.channel}`)
		);
		const missingDefaults = NOTIFICATION_CATEGORIES.flatMap((category) =>
			NOTIFICATION_CHANNELS.filter(
				(channel) => !existingKeys.has(`${category}:${channel}`)
			).map((channel) => ({
				category,
				channel,
				enabled: true,
				userId,
			}))
		);

		if (missingDefaults.length === 0) {
			return existing;
		}

		await db
			.insert(notificationPreference)
			.values(missingDefaults)
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
		const isUnreadOnly = query.unreadOnly === "true";

		const [items, totalResult, unreadCount] = await Promise.all([
			db
				.select()
				.from(notification)
				.where(whereClause)
				.orderBy(desc(notification.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(notification).where(whereClause),
			isUnreadOnly ? Promise.resolve(null) : this.getUnreadCount(userId),
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
			unreadCount: unreadCount ?? total,
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

	async sendToOrganizationAdmins(
		organizationId: string,
		payload: Omit<NotificationJobData, "userId">
	) {
		const [orgMembers, customRoles] = await Promise.all([
			db
				.select({ role: member.role, userId: member.userId })
				.from(member)
				.where(eq(member.organizationId, organizationId)),
			db
				.select({
					permission: organizationRole.permission,
					role: organizationRole.role,
				})
				.from(organizationRole)
				.where(eq(organizationRole.organizationId, organizationId)),
		]);

		const eligibleSet = new Set<string>(
			SYSTEM_ROLE_SLUGS.filter((slug: OrganizationRoleName) =>
				roleAllows(slug, "notification", "manage")
			)
		);
		for (const customRole of customRoles) {
			if (roleJsonAllows(customRole.permission, "notification", "manage")) {
				eligibleSet.add(customRole.role.trim().toLowerCase());
			}
		}
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
