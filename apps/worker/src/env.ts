import { APP_CONFIG } from "@workspace/shared/config";
import {
	LOG_FORMATS,
	LOG_LEVELS,
	normalizeOptionalLogEnv,
} from "@workspace/shared/logger";
import { hasDatabaseSslOrLocal } from "@workspace/shared/network";
import { z } from "zod";

const DEFAULT_DEV_SECRET =
	"default_development_secret_key_32_characters_minimum";
const VAPID_SUBJECT_REGEX = /^(?:mailto:|https?:\/\/)/iu;

const optionalTrimmedStringSchema = z
	.string()
	.optional()
	.transform((value) => {
		const trimmed = value?.trim();
		return trimmed ? trimmed : undefined;
	});

function isValidRedisUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === "redis:" || parsed.protocol === "rediss:") &&
			parsed.hostname.length > 0
		);
	} catch {
		return false;
	}
}

const workerEnvSchema = z
	.object({
		AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
		BETTER_AUTH_SECRET: z
			.string()
			.min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
			.default(DEFAULT_DEV_SECRET),
		DATABASE_SSL: z
			.string()
			.optional()
			.transform((value) => value?.trim().toLowerCase() === "true"),
		DATABASE_URL: z
			.string()
			.trim()
			.min(1, "DATABASE_URL is required")
			.default(
				`postgresql://postgres:postgres@localhost:5432/${APP_CONFIG.defaultDatabaseName}`
			),
		EMAIL_FROM: z
			.string()
			.trim()
			.min(1)
			.default(`${APP_CONFIG.name} <${APP_CONFIG.defaultFromEmail}>`),
		ENCRYPTION_SECRET: optionalTrimmedStringSchema.refine(
			(value) => (value ? value.length >= 32 : true),
			{
				message: "ENCRYPTION_SECRET must be at least 32 characters when set",
			}
		),
		LOG_FORMAT: z.preprocess(
			normalizeOptionalLogEnv,
			z.enum(LOG_FORMATS).optional()
		),
		LOG_LEVEL: z.preprocess(
			normalizeOptionalLogEnv,
			z.enum(LOG_LEVELS).optional()
		),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		NOTIFICATION_RETENTION_DAYS: z.coerce
			.number()
			.int()
			.min(1)
			.max(3650)
			.default(90),
		REDIS_PREFIX: z
			.string()
			.trim()
			.min(1)
			.default(APP_CONFIG.defaultRedisPrefix),
		REDIS_URL: z
			.string()
			.trim()
			.default("redis://localhost:6379")
			.refine(isValidRedisUrl, {
				message:
					"REDIS_URL must be a valid URL starting with redis:// or rediss://",
			}),
		RESEND_API_KEY: z.string().trim().default(""),
		VAPID_PRIVATE_KEY: z.string().trim().default(""),
		VAPID_PUBLIC_KEY: z.string().trim().default(""),
		VAPID_SUBJECT: z
			.string()
			.trim()
			.default("mailto:admin@example.com")
			.refine((val) => VAPID_SUBJECT_REGEX.test(val), {
				message: "VAPID_SUBJECT must start with mailto:, http://, or https://",
			}),
		WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
		WORKER_HEALTH_HOST: z.string().trim().min(1).default("0.0.0.0"),
		WORKER_HEALTH_PORT: z.coerce
			.number()
			.int()
			.min(0)
			.max(65_535)
			.default(3002),
	})
	.superRefine((data, ctx) => {
		const hasPublic = data.VAPID_PUBLIC_KEY.length > 0;
		const hasPrivate = data.VAPID_PRIVATE_KEY.length > 0;
		if (hasPublic !== hasPrivate) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set when configuring Web Push",
				path: [hasPublic ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY"],
			});
		}
	});

export type WorkerEnv = Omit<
	z.infer<typeof workerEnvSchema>,
	"ENCRYPTION_SECRET"
> & {
	ENCRYPTION_SECRET: string;
};

export function parseWorkerEnv(
	source: Record<string, string | undefined> = process.env
): WorkerEnv {
	const parsed = workerEnvSchema.safeParse(source);

	if (!parsed.success) {
		throw new Error(
			`Invalid Worker environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
		);
	}

	const { data } = parsed;
	const resolvedEncryptionSecret =
		data.ENCRYPTION_SECRET ?? data.BETTER_AUTH_SECRET;

	if (data.NODE_ENV === "production") {
		if (!source.DATABASE_URL?.trim()) {
			throw new Error("DATABASE_URL is required in production");
		}
		if (!source.REDIS_URL?.trim()) {
			throw new Error("REDIS_URL is required in production");
		}
		if (!data.RESEND_API_KEY) {
			throw new Error("RESEND_API_KEY is required in production");
		}
		if (!hasDatabaseSslOrLocal(data.DATABASE_URL, data.DATABASE_SSL)) {
			throw new Error(
				"DATABASE_SSL=true or sslmode=require is required for remote PostgreSQL hosts in production"
			);
		}
		if (
			data.ENCRYPTION_SECRET === DEFAULT_DEV_SECRET ||
			(data.VAPID_PRIVATE_KEY &&
				resolvedEncryptionSecret === DEFAULT_DEV_SECRET)
		) {
			throw new Error(
				"ENCRYPTION_SECRET (or BETTER_AUTH_SECRET) must not use the default fallback secret in production"
			);
		}
	}

	return {
		...data,
		ENCRYPTION_SECRET: resolvedEncryptionSecret,
	};
}

export const env = parseWorkerEnv();
