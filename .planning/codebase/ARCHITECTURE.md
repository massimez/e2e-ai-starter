# Architecture Overview

## Monorepo Layout
- **`apps/api` subpath exports**: Concrete API domain modules exported cleanly as `@workspace/api/config` (`APP_CONFIG` branding defaults), `@workspace/api/logger` (unified pretty/JSON structured logger and secret redaction), `@workspace/api/permissions` (Better Auth RBAC `ac`, `roles`, `PERMISSION_MATRIX`), `@workspace/api/queues` (BullMQ queue names, notification categories/channels), `@workspace/api/storage` (upload limits and MIME allowlists), and `@workspace/api/hc` (Hono RPC client types).
- **`apps/api`**: Hono API service on Bun (Port 3001).
  - Hosts Better Auth endpoints (`/api/auth/*`), health probes (`/api/health/*`), Mastra AI endpoints (`/api/ai/*`), organization management, dynamic RBAC roles, invitations & ownership transfer (`/api/organizations/*`, including `modules/roles/`), private storage (`/api/storage/*`), and notifications (`/api/notifications/*`).
  - Applies request IDs, CORS, secure headers, rate limiting, active-ban checks, tenant boundary enforcement, RBAC permission caching, and audit logging.
- **`apps/web`**: Next.js 16 App Router application (Port 3000).
  - `src/proxy.ts` redirects unauthenticated requests matching `["/dashboard/:path*", "/onboarding"]` toward `/?auth=signin&callbackUrl=...`.
  - Routes include `/onboarding` (new-user workspace setup), `/accept-invitation`, `/dashboard`, `/dashboard/ai`, and `/dashboard/settings/{general,members,roles,notifications,advanced}`.
  - `src/components/site-footer.tsx` (`SiteFooter`) renders all 11 brand icons from `@workspace/ui/components/icons/brands/*`.
  - Server Components verify sessions cleanly against the API via `getServerSession()` (`src/lib/auth-server.ts`).
  - Client modules in `src/lib/` provide the typed Hono RPC client (`api-client.ts`), Better Auth browser client (`auth-client.ts`), and React Query organization hooks (`organization-hooks.ts`), plus `/dashboard/ai` streaming chat (`@ai-sdk/react` `useChat` + `DefaultChatTransport` on same-origin `/api/ai/chat`).
  - Client requests call `/api/*`, transparently rewritten by `next.config.ts` to `INTERNAL_API_URL || NEXT_PUBLIC_API_URL || "http://localhost:3001"`.
- **`apps/worker`**: Standalone BullMQ worker process (Port 3002 probes) consuming `email` and `notification` queues and dispatching emails (Resend) and Web Push payloads (`web-push`).
- **`packages/ai-core`**: Mastra AI core (`@workspace/ai-core`, `@workspace/ai-core/contracts`) hosting provider-agnostic agents (`workspace-assistant`; `AI_PROVIDERS` registry for Google, OpenAI, Anthropic, OpenRouter), tenant-scoped `RequestContext` tools backed by `@workspace/db`, `workspace-brief` workflow, `Observability` (`SensitiveDataFilter`), and `@mastra/pg` (`PostgresStore` + `PgVector`) isolated in the `mastra` PostgreSQL schema. Run Studio via `bun run dev:ai`.
- **`packages/db`**: Drizzle ORM schemas (`schemaFilter: ["public"]`), SQL migrations (including `pgvector` extension enablement and Docker init SQL), relations, seed script, and HMR-safe connection pool with graceful shutdown.
- **`packages/ui`**: Tailwind CSS v4 tokens, primitives, auth flows, brand icons (`src/components/icons/brands/*`), notification center, and organization switcher.

## Data & Auth Flow
1. **Client Auth & Data**: React components use `authClient` (`@/lib/auth-client`), `@/lib/organization-hooks`, `@ai-sdk/react` (`useChat` -> `/api/ai/chat`), and typed Hono RPC calls (`@/lib/api-client`) on the same `/api/*` origin.
2. **Backend Processing**: Requests are rewritten (or routed) to `apps/api`, where Better Auth + Redis secondary storage validate sessions and Hono routes enforce tenant boundaries and permissions before querying PostgreSQL/S3 or invoking Mastra with a verified `RequestContext` and `${organizationId}:${userId}` memory `resourceId`.
3. **Async Work**: Transactional emails (`verification OTP`, `welcome`, `invitation`, `password reset`) and multi-channel notifications (`in_app`, `email`, `push`) are enqueued to Redis and processed asynchronously by `apps/worker`.
