import { lookup } from "node:dns/promises";
import { encryptSecretValue } from "@workspace/shared/crypto";
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
import { env } from "../../env";
import { ValidationError } from "../../lib/errors";
import { enqueueNotificationsBulk } from "./queue";
import {
	drizzleNotificationRepository,
	type NotificationRepository,
} from "./repository";
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

/**
 * Builds the notification domain service backed by the given repository.
 */
export function createNotificationService(
	repository: NotificationRepository = drizzleNotificationRepository
) {
	return {
		async deletePushSubscription(userId: string, endpoint: string) {
			await repository.deletePushSubscription(userId, endpoint);
			return { success: true };
		},

		async getPreferences(userId: string) {
			const existing = await repository.findPreferences(userId);
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

			await repository.insertMissingPreferences(missingDefaults);
			return await repository.findPreferences(userId);
		},

		async getUnreadCount(userId: string): Promise<number> {
			return await repository.countUnread(userId);
		},

		async getUserNotifications(userId: string, query: ListNotificationsQuery) {
			const isUnreadOnly = query.unreadOnly === "true";

			const [{ items, total }, unreadCount] = await Promise.all([
				repository.listUserNotifications({
					limit: query.limit,
					offset: query.offset,
					unreadOnly: isUnreadOnly,
					userId,
				}),
				isUnreadOnly ? Promise.resolve(null) : repository.countUnread(userId),
			]);

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
			await repository.markAllAsRead(userId, new Date());
			return { success: true };
		},

		async markAsRead(userId: string, notificationId: string) {
			return await repository.markAsRead(userId, notificationId, new Date());
		},

		async savePushSubscription(userId: string, input: PushSubscriptionInput) {
			await assertSafePushEndpoint(input.endpoint);
			const encryptedInput: PushSubscriptionInput = {
				...input,
				keys: {
					auth: encryptSecretValue(input.keys.auth, env.ENCRYPTION_SECRET),
					p256dh: encryptSecretValue(input.keys.p256dh, env.ENCRYPTION_SECRET),
				},
			};
			return await repository.upsertPushSubscription({
				input: encryptedInput,
				updatedAt: new Date(),
				userId,
			});
		},

		async sendToOrganizationAdmins(
			organizationId: string,
			payload: Omit<NotificationJobData, "userId">
		) {
			const { customRoles, members } =
				await repository.findOrganizationMembersAndRoles(organizationId);

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
			for (const orgMember of members) {
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
			return await repository.upsertPreference({
				category: input.category,
				channel: input.channel,
				enabled: input.enabled,
				updatedAt: new Date(),
				userId,
			});
		},
	};
}

export const notificationService = createNotificationService();
