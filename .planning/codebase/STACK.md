# Technology Stack

- **Runtime & Package Manager**: Bun (workspaces, `linker = "isolated"`, package catalog)
- **Monorepo Engine**: Turborepo
- **Backend API**: Hono on Bun, IORedis, BullMQ, AWS SDK S3 & request presigner, `@mastra/ai-sdk` (`handleChatStream` v7)
- **AI & Memory**: Mastra (`@mastra/core`, `@mastra/pg`, `@mastra/memory`, `@mastra/observability`, `mastra` CLI/Studio), model router with Google Gemini (default `google/gemini-2.5-flash`), OpenAI, Anthropic, OpenRouter; embeddings via `google/gemini-embedding-001` or `openai/text-embedding-3-*`, AI SDK (`ai`, `@ai-sdk/react`)
- **Worker**: BullMQ, Resend REST API email sender, `web-push` (VAPID Web Push)
- **Frontend**: Next.js 16 (App Router, `src/proxy.ts`), React 19, Tailwind CSS v4, TanStack Query, `@ai-sdk/react`, Lucide React, Radix UI Primitives, Sonner
- **Database & Vector ORM**: PostgreSQL 16 + `pgvector` (`docker.io/pgvector/pgvector:pg16`), Drizzle ORM (`schemaFilter: ["public"]`), Drizzle Kit, `postgres` driver + `pg` (used by `@mastra/pg` in `mastra` schema)
- **Authentication**: Better Auth (`better-auth`, `@better-auth/drizzle-adapter`)
  - Plugins: Organization (multi-tenant), Admin, Email OTP (`storeOTP: "hashed"`), Access Control (RBAC from `apps/api/src/lib/auth/permissions.ts`, exported as `@workspace/api/permissions`)
- **Validation**: Zod v4
- **Code Quality**: Ultracite + Biome + Bun test runner (`bun run test`)
