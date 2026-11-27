import { APP_CONFIG } from "@workspace/shared/config";
import {
	LOG_FORMATS,
	LOG_LEVELS,
	normalizeOptionalLogEnv,
} from "@workspace/shared/logger";
import {
	hasDatabaseSslOrLocal,
	isHttpsOrLocalUrl,
} from "@workspace/shared/network";
import { z } from "zod";

const DEFAULT_DEV_SECRET =
	"default_development_secret_key_32_characters_minimum";
const MODEL_ID_REGEX = /^[a-z0-9-]+\/.+$/iu;

function parseCsvList(raw: string): string[] {
	return raw
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function isValidHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function isValidRedisUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "redis:" || parsed.protocol === "rediss:";
	} catch {
		return false;
	}
}

const optionalTrimmedStringSchema = z
	.string()
	.optional()
	.transform((value) => {
		const trimmed = value?.trim();
		return trimmed ? trimmed : undefined;
	});

const optionalUrlSchema = optionalTrimmedStringSchema.refine(
	(value) => (value ? isValidHttpUrl(value) : true),
	{
		message: "Must be a valid http:// or https:// URL",
	}
);

function validateProductionEnv(
	data: {
		BETTER_AUTH_SECRET: string;
		BETTER_AUTH_URL: string;
		CORS_ORIGIN: string;
		DATABASE_SSL: boolean;
		DATABASE_URL: string;
		ENCRYPTION_SECRET: string | undefined;
		QUEUE_DRIVER: "inline" | "redis";
		S3_USE_IAM_ROLE: boolean;
	},
	rawInput: Record<string, string | undefined>,
	ctx: z.RefinementCtx
): void {
	if (data.BETTER_AUTH_SECRET === DEFAULT_DEV_SECRET) {
		ctx.addIssue({
			code: "custom",
			message:
				"BETTER_AUTH_SECRET must not use the default fallback secret in production.",
			path: ["BETTER_AUTH_SECRET"],
		});
	}

	if (data.ENCRYPTION_SECRET === DEFAULT_DEV_SECRET) {
		ctx.addIssue({
			code: "custom",
			message:
				"ENCRYPTION_SECRET must not use the default fallback secret in production.",
			path: ["ENCRYPTION_SECRET"],
		});
	}

	if (!isHttpsOrLocalUrl(data.BETTER_AUTH_URL)) {
		ctx.addIssue({
			code: "custom",
			message:
				"BETTER_AUTH_URL must use https:// in production (except localhost/127.0.0.1).",
			path: ["BETTER_AUTH_URL"],
		});
	}

	const insecureOrigins = parseCsvList(data.CORS_ORIGIN).filter(
		(origin) => !isHttpsOrLocalUrl(origin)
	);
	if (insecureOrigins.length > 0) {
		ctx.addIssue({
			code: "custom",
			message:
				"CORS_ORIGIN entries must use https:// in production (except localhost/127.0.0.1).",
			path: ["CORS_ORIGIN"],
		});
	}

	if (!hasDatabaseSslOrLocal(data.DATABASE_URL, data.DATABASE_SSL)) {
		ctx.addIssue({
			code: "custom",
			message:
				"DATABASE_SSL=true or sslmode=require must be enabled for remote PostgreSQL hosts in production.",
			path: ["DATABASE_SSL"],
		});
	}

	const requiredInProd: string[] = [
		"DATABASE_URL",
		"BETTER_AUTH_URL",
		"CORS_ORIGIN",
	];

	if (!data.S3_USE_IAM_ROLE) {
		requiredInProd.push("S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY");
	}

	if (data.QUEUE_DRIVER === "redis") {
		requiredInProd.push("REDIS_URL");
	}

	for (const key of requiredInProd) {
		if (!rawInput[key]?.trim()) {
			ctx.addIssue({
				code: "custom",
				message: `${key} must be explicitly configured in production.`,
				path: [key],
			});
		}
	}
}

function createApiEnvSchema(rawInput: Record<string, string | undefined>) {
	return z
		.object({
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
			PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
			DATABASE_URL: z
				.string()
				.min(1, "DATABASE_URL is required")
				.default(
					`postgresql://postgres:postgres@localhost:5432/${APP_CONFIG.defaultDatabaseName}`
				),
			DATABASE_SSL: z
				.string()
				.optional()
				.transform((value) => value?.trim().toLowerCase() === "true"),
			BETTER_AUTH_SECRET: z
				.string()
				.min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
				.default(DEFAULT_DEV_SECRET),
			ENCRYPTION_SECRET: optionalTrimmedStringSchema.refine(
				(value) => (value ? value.length >= 32 : true),
				{
					message: "ENCRYPTION_SECRET must be at least 32 characters when set",
				}
			),
			SESSION_EXPIRES_IN_SECONDS: z.coerce
				.number()
				.int()
				.min(300)
				.default(604_800),
			SESSION_UPDATE_AGE_SECONDS: z.coerce
				.number()
				.int()
				.min(60)
				.default(86_400),
			BETTER_AUTH_URL: z
				.string()
				.refine(isValidHttpUrl, "BETTER_AUTH_URL must be a valid HTTP(S) URL")
				.default("http://localhost:3001"),
			CORS_ORIGIN: z
				.string()
				.default("http://localhost:3000")
				.refine(
					(value) => {
						const origins = parseCsvList(value);
						return (
							origins.length > 0 &&
							origins.every((origin) => isValidHttpUrl(origin))
						);
					},
					{
						message:
							"CORS_ORIGIN must contain one or more comma-separated HTTP(S) origins",
					}
				),
			TRUSTED_PROXY_CIDRS: z.string().default(""),
			TURNSTILE_SECRET_KEY: z.string().trim().default(""),
			TURNSTILE_ALLOWED_HOSTNAMES: z.string().default(""),
			GOOGLE_CLIENT_ID: z.string().default(""),
			GOOGLE_CLIENT_SECRET: z.string().default(""),
			S3_BUCKET: z.string().min(1).default(APP_CONFIG.defaultBucketName),
			S3_REGION: z.string().min(1).default("us-east-1"),
			S3_ENDPOINT: optionalUrlSchema,
			S3_ACCESS_KEY_ID: z.string().default(""),
			S3_SECRET_ACCESS_KEY: z.string().default(""),
			S3_PUBLIC_URL: optionalUrlSchema,
			S3_USE_IAM_ROLE: z
				.string()
				.optional()
				.transform((value) => value?.trim().toLowerCase() === "true"),
			QUEUE_DRIVER: z.enum(["redis", "inline"]).default("redis"),
			REDIS_URL: z
				.string()
				.refine(isValidRedisUrl, "REDIS_URL must be a valid redis:// URL")
				.default("redis://localhost:6379"),
			REDIS_PREFIX: z.string().min(1).default(APP_CONFIG.defaultRedisPrefix),
			// AI provider keys (Mastra reads these from process.env; listed here for validation & preflight checks)
			GOOGLE_GENERATIVE_AI_API_KEY: optionalTrimmedStringSchema,
			GOOGLE_API_KEY: optionalTrimmedStringSchema,
			OPENAI_API_KEY: optionalTrimmedStringSchema,
			ANTHROPIC_API_KEY: optionalTrimmedStringSchema,
			OPENROUTER_API_KEY: optionalTrimmedStringSchema,
			MASTRA_DB_SCHEMA: z.string().trim().min(1).default("mastra"),
			MASTRA_DEFAULT_MODEL: z
				.string()
				.trim()
				.regex(
					MODEL_ID_REGEX,
					"MASTRA_DEFAULT_MODEL must use the provider/model format (e.g. openai/gpt-5-mini)"
				)
				.default("google/gemini-3.5-flash-lite"),
			MASTRA_EMBEDDING_MODEL: z
				.string()
				.trim()
				.refine(
					(value) => value.startsWith("google/") || value.startsWith("openai/"),
					"MASTRA_EMBEDDING_MODEL must be a google/* or openai/* embedding model"
				)
				.default("google/gemini-embedding-001"),
			MASTRA_EMBEDDING_DIMENSIONS: z.coerce
				.number()
				.int()
				.positive()
				.max(2000)
				.default(768),
		})
		.superRefine((data, ctx) => {
			if (
				Boolean(data.GOOGLE_CLIENT_ID.trim()) !==
				Boolean(data.GOOGLE_CLIENT_SECRET.trim())
			) {
				ctx.addIssue({
					code: "custom",
					message:
						"GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set when configuring Google OAuth.",
					path: ["GOOGLE_CLIENT_ID"],
				});
			}

			if (data.NODE_ENV !== "production") {
				return;
			}

			validateProductionEnv(data, rawInput, ctx);
		});
}

export function parseApiEnv(
	input: Record<string, string | undefined> = process.env
) {
	const parsed = createApiEnvSchema(input).safeParse(input);

	if (!parsed.success) {
		console.error(
			"Invalid API environment variables:\n",
			JSON.stringify(z.treeifyError(parsed.error), null, 2)
		);
		throw new Error("Invalid API environment variables");
	}

	const rawEnv = parsed.data;
	return {
		...rawEnv,
		CORS_ORIGINS: parseCsvList(rawEnv.CORS_ORIGIN).map(
			(origin) => new URL(origin).origin
		),
		ENCRYPTION_SECRET: rawEnv.ENCRYPTION_SECRET ?? rawEnv.BETTER_AUTH_SECRET,
		TRUSTED_PROXY_CIDRS_LIST: parseCsvList(rawEnv.TRUSTED_PROXY_CIDRS),
		TURNSTILE_ALLOWED_HOSTNAMES_LIST: parseCsvList(
			rawEnv.TURNSTILE_ALLOWED_HOSTNAMES
		),
	};
}

export const env = parseApiEnv(process.env);
