import { z } from "zod";
import {
	notificationCategorySchema,
	notificationChannelSchema,
} from "../../lib/queues";

const HTTP_URL_REGEX = /^https?:\/\//iu;

export const notificationIdParamSchema = z.object({
	id: z.string().uuid("Invalid notification ID"),
});

export const listNotificationsQuerySchema = z.object({
	limit: z.coerce.number().int().positive().max(100).default(20),
	offset: z.coerce.number().int().nonnegative().max(10_000).default(0),
	unreadOnly: z.enum(["true", "false"]).optional(),
});

export const updatePreferenceSchema = z.object({
	category: notificationCategorySchema,
	channel: notificationChannelSchema,
	enabled: z.boolean(),
});

export const pushSubscriptionSchema = z.object({
	endpoint: z
		.string()
		.url()
		.max(2048)
		.refine((val) => HTTP_URL_REGEX.test(val), {
			message: "Push endpoint must use http or https",
		}),
	keys: z.object({
		auth: z.string().min(1),
		p256dh: z.string().min(1),
	}),
	userAgent: z.string().max(512).optional(),
});

export const deletePushSubscriptionSchema = z.object({
	endpoint: z.string().url().max(2048),
});

export type ListNotificationsQuery = z.infer<
	typeof listNotificationsQuerySchema
>;
export type UpdatePreferenceInput = z.infer<typeof updatePreferenceSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
