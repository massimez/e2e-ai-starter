import { z } from "zod";

export const EMAIL_QUEUE_NAME = "email-queue";
export const NOTIFICATION_QUEUE_NAME = "notification-queue";
export const RETENTION_QUEUE_NAME = "retention-queue";

export const retentionJobDataSchema = z.object({
	triggeredBy: z.enum(["schedule", "manual"]).default("schedule"),
});

export type RetentionJobData = z.infer<typeof retentionJobDataSchema>;

export const NOTIFICATION_CATEGORIES = [
	"system",
	"security",
	"team",
	"project",
	"billing",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

const httpUrlSchema = z
	.string()
	.url()
	.refine((value) => {
		try {
			const parsed = new URL(value);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}, "URL must use http or https protocol");

export const verificationOtpEmailSchema = z.object({
	payload: z.object({
		code: z.string().trim().min(1).max(32),
		type: z.string().trim().min(1).max(64).default("verification"),
	}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("verification-otp"),
	to: z.string().trim().email(),
});

export const welcomeEmailSchema = z.object({
	payload: z.object({
		name: z.string().trim().max(120).optional(),
	}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("welcome"),
	to: z.string().trim().email(),
});

export const resetPasswordEmailSchema = z.object({
	payload: z
		.object({
			link: httpUrlSchema.optional(),
			name: z.string().trim().max(120).optional(),
			url: httpUrlSchema.optional(),
		})
		.refine((value) => Boolean(value.url || value.link), {
			message: "A valid reset URL is required",
		}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("reset-password"),
	to: z.string().trim().email(),
});

export const invitationEmailSchema = z.object({
	payload: z
		.object({
			inviterName: z.string().trim().max(120).optional(),
			link: httpUrlSchema.optional(),
			organizationName: z.string().trim().max(160).optional(),
			role: z.string().trim().max(64).optional(),
			url: httpUrlSchema.optional(),
		})
		.refine((value) => Boolean(value.url || value.link), {
			message: "A valid invitation URL is required",
		}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("invitation"),
	to: z.string().trim().email(),
});

export const emailJobDataSchema = z.discriminatedUnion("template", [
	verificationOtpEmailSchema,
	welcomeEmailSchema,
	resetPasswordEmailSchema,
	invitationEmailSchema,
]);

export type EmailJobData = z.infer<typeof emailJobDataSchema>;

export const notificationJobDataSchema = z.object({
	category: notificationCategorySchema,
	channels: z.array(notificationChannelSchema).min(1).optional(),
	content: z.string().trim().min(1).max(4000),
	data: z.record(z.string(), z.unknown()).optional(),
	idempotencyKey: z.string().trim().min(1).max(128).optional(),
	organizationId: z.string().trim().min(1).nullable().optional(),
	title: z.string().trim().min(1).max(200),
	type: z.string().trim().min(1).max(100),
	userId: z.string().trim().min(1),
});

export type NotificationJobData = z.infer<typeof notificationJobDataSchema>;

export interface ParsedRedisConnectionOptions {
	db: number;
	host: string;
	password: string | undefined;
	port: number;
	tls: Record<string, never> | undefined;
	username: string | undefined;
}

export function parseRedisConnectionOptions(
	redisUrl: string
): ParsedRedisConnectionOptions {
	const parsed = new URL(redisUrl);
	const dbSegment = parsed.pathname.replace("/", "");
	const parsedDb = dbSegment ? Number.parseInt(dbSegment, 10) : 0;

	return {
		db: Number.isNaN(parsedDb) ? 0 : parsedDb,
		host: parsed.hostname || "localhost",
		password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
		port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
		tls: parsed.protocol === "rediss:" ? {} : undefined,
		username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
	};
}

/**
 * Races an async operation against a timeout and clears the timer in `finally`.
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	timeoutMessage = "Operation timed out"
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}
