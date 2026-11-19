import { z } from "zod";
import { APP_CONFIG } from "./lib/app-config";
import { LOG_FORMATS, LOG_LEVELS, normalizeOptionalLogEnv } from "./lib/logger";

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
			BETTER_AUTH_SECRET: z
				.string()
				.min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
				.default(DEFAULT_DEV_SECRET),
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
				.default("google/gemini-2.5-flash"),
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
					code: z.ZodIssueCode.custom,
					message:
						"GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set when configuring Google OAuth.",
					path: ["GOOGLE_CLIENT_ID"],
				});
			}

			if (data.NODE_ENV !== "production") {
				return;
			}

			if (data.BETTER_AUTH_SECRET === DEFAULT_DEV_SECRET) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"BETTER_AUTH_SECRET must not use the default fallback secret in production.",
					path: ["BETTER_AUTH_SECRET"],
				});
			}

			const requiredInProd = [
				"DATABASE_URL",
				"REDIS_URL",
				"BETTER_AUTH_URL",
				"CORS_ORIGIN",
				"S3_ACCESS_KEY_ID",
				"S3_SECRET_ACCESS_KEY",
			] as const;

			for (const key of requiredInProd) {
				if (!rawInput[key]?.trim()) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `${key} must be explicitly configured in production.`,
						path: [key],
					});
				}
			}
		});
}

export function parseApiEnv(
	input: Record<string, string | undefined> = process.env
) {
	const parsed = createApiEnvSchema(input).safeParse(input);

	if (!parsed.success) {
		console.error(
			"Invalid API environment variables:\n",
			JSON.stringify(parsed.error.format(), null, 2)
		);
		throw new Error("Invalid API environment variables");
	}

	const rawEnv = parsed.data;
	return {
		...rawEnv,
		CORS_ORIGINS: parseCsvList(rawEnv.CORS_ORIGIN),
		TRUSTED_PROXY_CIDRS_LIST: parseCsvList(rawEnv.TRUSTED_PROXY_CIDRS),
		TURNSTILE_ALLOWED_HOSTNAMES_LIST: parseCsvList(
			rawEnv.TURNSTILE_ALLOWED_HOSTNAMES
		),
	};
}

export const env = parseApiEnv(process.env);
