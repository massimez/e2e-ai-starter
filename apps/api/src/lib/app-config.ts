/**
 * Canonical application branding and template defaults shared across
 * web, API, and worker workspaces without runtime dependencies.
 */
export const APP_CONFIG = {
	defaultBucketName: "starter-uploads",
	defaultDatabaseName: "starter_db",
	defaultFromEmail: "noreply@example.com",
	defaultRedisPrefix: "starter",
	description:
		"Bun and Turborepo starter with Better Auth multi-tenancy, RBAC, Hono RPC, Drizzle ORM, Mastra AI agents (Gemini, OpenAI, Anthropic, OpenRouter) and pgvector, private S3/R2 storage, and BullMQ workers.",
	keywords: [
		"nextjs",
		"nextjs-16",
		"react-19",
		"hono",
		"bun",
		"turborepo",
		"mastra",
		"ai-agents",
		"better-auth",
		"drizzle-orm",
		"postgresql",
		"pgvector",
		"bullmq",
		"redis",
		"multi-tenant",
		"rbac",
		"tailwind-css",
		"typescript",
	],
	name: "E2E AI Starter",
	tagline: "Multi-Tenant Next.js, Hono, Drizzle & Mastra AI Starter",
} as const;
