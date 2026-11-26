import { db } from "@workspace/db";
import {
	member,
	notification,
	notificationPreference,
	organizationRole,
	pushSubscription,
} from "@workspace/db/schema";
import type {
	NotificationCategory,
	NotificationChannel,
} from "@workspace/shared/queues";
import { and, count, desc, eq } from "drizzle-orm";
import type { PushSubscriptionInput } from "./schema";

/**
 * Builds the Drizzle-backed repository for notification, preference, and push subscription persistence.
 */
export function createDrizzleNotificationRepository(database = db) {
	return {
		async countUnread(userId: string): Promise<number> {
			const [result] = await database
				.select({ unreadCount: count() })
				.from(notification)
				.where(
					and(eq(notification.userId, userId), eq(notification.isRead, false))
				);
			return result?.unreadCount ?? 0;
		},

		async deletePushSubscription(
			userId: string,
			endpoint: string
		): Promise<void> {
			await database
				.delete(pushSubscription)
				.where(
					and(
						eq(pushSubscription.userId, userId),
						eq(pushSubscription.endpoint, endpoint)
					)
				);
		},

		async findOrganizationMembersAndRoles(organizationId: string) {
			const [members, customRoles] = await Promise.all([
				database
					.select({ role: member.role, userId: member.userId })
					.from(member)
					.where(eq(member.organizationId, organizationId)),
				database
					.select({
						permission: organizationRole.permission,
						role: organizationRole.role,
					})
					.from(organizationRole)
					.where(eq(organizationRole.organizationId, organizationId)),
			]);
			return { customRoles, members };
		},

		async findPreferences(userId: string) {
			return await database
				.select()
				.from(notificationPreference)
				.where(eq(notificationPreference.userId, userId));
		},

		async insertMissingPreferences(
			rows: Array<{
				category: NotificationCategory;
				channel: NotificationChannel;
				enabled: boolean;
				userId: string;
			}>
		): Promise<void> {
			if (rows.length === 0) {
				return;
			}
			await database
				.insert(notificationPreference)
				.values(rows)
				.onConflictDoNothing();
		},

		async listUserNotifications(params: {
			limit: number;
			offset: number;
			unreadOnly: boolean;
			userId: string;
		}) {
			const conditions = [eq(notification.userId, params.userId)];
			if (params.unreadOnly) {
				conditions.push(eq(notification.isRead, false));
			}

			const whereClause = and(...conditions);

			const [items, totalResult] = await Promise.all([
				database
					.select()
					.from(notification)
					.where(whereClause)
					.orderBy(desc(notification.createdAt))
					.limit(params.limit)
					.offset(params.offset),
				database
					.select({ total: count() })
					.from(notification)
					.where(whereClause),
			]);

			return {
				items,
				total: totalResult[0]?.total ?? 0,
			};
		},

		async markAllAsRead(userId: string, readAt: Date): Promise<void> {
			await database
				.update(notification)
				.set({ isRead: true, readAt })
				.where(
					and(eq(notification.userId, userId), eq(notification.isRead, false))
				);
		},

		async markAsRead(userId: string, notificationId: string, readAt: Date) {
			const [updated] = await database
				.update(notification)
				.set({ isRead: true, readAt })
				.where(
					and(
						eq(notification.id, notificationId),
						eq(notification.userId, userId)
					)
				)
				.returning();
			return updated ?? null;
		},

		async upsertPreference(params: {
			category: NotificationCategory;
			channel: NotificationChannel;
			enabled: boolean;
			updatedAt: Date;
			userId: string;
		}) {
			const [updated] = await database
				.insert(notificationPreference)
				.values({
					category: params.category,
					channel: params.channel,
					enabled: params.enabled,
					updatedAt: params.updatedAt,
					userId: params.userId,
				})
				.onConflictDoUpdate({
					set: {
						enabled: params.enabled,
						updatedAt: params.updatedAt,
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

		async upsertPushSubscription(params: {
			input: PushSubscriptionInput;
			updatedAt: Date;
			userId: string;
		}) {
			const [sub] = await database
				.insert(pushSubscription)
				.values({
					endpoint: params.input.endpoint,
					keys: params.input.keys,
					updatedAt: params.updatedAt,
					userAgent: params.input.userAgent ?? null,
					userId: params.userId,
				})
				.onConflictDoUpdate({
					set: {
						keys: params.input.keys,
						updatedAt: params.updatedAt,
						userAgent: params.input.userAgent ?? null,
					},
					target: [pushSubscription.userId, pushSubscription.endpoint],
				})
				.returning({
					createdAt: pushSubscription.createdAt,
					endpoint: pushSubscription.endpoint,
					id: pushSubscription.id,
					updatedAt: pushSubscription.updatedAt,
					userAgent: pushSubscription.userAgent,
					userId: pushSubscription.userId,
				});
			return sub;
		},
	};
}

export type NotificationRepository = ReturnType<
	typeof createDrizzleNotificationRepository
>;

export const drizzleNotificationRepository =
	createDrizzleNotificationRepository();
