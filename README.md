# e2e-ai-starter

> **Production-Ready Multi-Tenant SaaS & AI Starter**: Next.js 16 App Router · Hono API on Bun · Mastra AI Agents with pgvector · Better Auth Dynamic RBAC · Drizzle ORM · BullMQ · Tailwind CSS v4 · Turborepo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0.2-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.4+-fbf0df.svg)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-API-e36002.svg)](https://hono.dev/)
[![Mastra AI](https://img.shields.io/badge/Mastra-AI%20Agents-purple.svg)](https://mastra.ai/)
[![Better Auth](https://img.shields.io/badge/Better%20Auth-Multi--Tenant-red.svg)](https://better-auth.com/)

A TypeScript Turborepo monorepo template powered by **Next.js 16 (App Router)**, **Hono API** (running natively on Bun), **Mastra AI** (Google Gemini, OpenAI, Anthropic, or OpenRouter + `pgvector` memory), **Better Auth** (with multi-tenant organizations, Email OTP, and native Dynamic Access Control), **Drizzle ORM** (PostgreSQL + `pgvector`), **BullMQ** (Redis background worker), **Tailwind CSS v4**, and a leaf shared contracts package (`@workspace/shared/{config,logger,network,permissions,queues,storage}`).

---

## Using as a Template

1. Create a new repository from this template (GitHub **Use this template** or `bun create <owner>/<repo> my-app`).
2. Initialize project branding, database/bucket defaults, and a fresh `BETTER_AUTH_SECRET`:
   ```bash
   bun run setup --name "My App" --slug my-app
   ```
   Running `bun run setup` updates [package.json](package.json), [packages/shared/src/config.ts](packages/shared/src/config.ts) (`APP_CONFIG`), [apps/web/src/app/icon.svg](apps/web/src/app/icon.svg), and generates root `.env` (from `.env.example`) plus standalone [apps/web/.env](apps/web/.env) (from `apps/web/.env.example`) when missing (`--force-env` overwrites both).
3. [docker-compose.yml](docker-compose.yml) scopes container names per Compose project directory automatically, preventing collisions when running multiple cloned projects on one machine.
4. For advanced rebranding, edit `APP_CONFIG` in [packages/shared/src/config.ts](packages/shared/src/config.ts) and replace [apps/web/src/app/icon.svg](apps/web/src/app/icon.svg) / [apps/web/src/components/brand-mark.tsx](apps/web/src/components/brand-mark.tsx).

---

## ⚡ Tech Stack

| Domain | Technology |
|---|---|
| **Runtime & Monorepo** | [Bun](https://bun.sh) (workspaces, `isolated` linker, package catalog) & [Turborepo](https://turbo.build) |
| **Shared Leaf Contracts** | `@workspace/shared/{config,logger,network,permissions,queues,storage}` (branding, Pino logger, SSRF IP checks, Better Auth RBAC `ac`/`roles`, queue schemas, storage allowlists) |
| **Backend API** | [Hono](https://hono.dev) (running natively on Bun at `http://localhost:3001`, exporting type-only `AppType` via `@workspace/api/hc`) |
| **Frontend Web** | [Next.js 16](https://nextjs.org) (App Router, React 19 at `http://localhost:3000`, `src/proxy.ts` & runtime streaming `/api/[...path]` proxy) |
| **Authentication & RBAC** | [Better Auth](https://better-auth.com) (Drizzle adapter, Email/Password, Email OTP, optional Google OAuth, Organizations + native `dynamicAccessControl`) |
| **Database & Vector ORM** | [PostgreSQL 16 + pgvector](https://github.com/pgvector/pgvector) & [Drizzle ORM](https://orm.drizzle.team) (`schemaFilter: ["public"]`, isolated `mastra` AI schema) |
| **AI Agents & Memory** | [Mastra](https://mastra.ai) (`@workspace/ai-core`), multi-provider model router (Gemini default, OpenAI, Anthropic, OpenRouter; Google/OpenAI embeddings), `@mastra/pg`, & [AI SDK](https://ai-sdk.dev) |
| **Worker & Storage** | [BullMQ](https://bullmq.io) & Redis (`QUEUE_DRIVER=redis|inline`) + S3/R2/MinIO (`@aws-sdk/client-s3`) |
| **Styling & UI** | [Tailwind CSS v4](https://tailwindcss.com), Lucide React, Sonner Toasts, Radix UI Primitives |
| **Linter & Formatter** | [Ultracite](https://github.com/biomejs/biome) / Biome |

---

## 📁 Repository Structure

```
e2e-ai-starter/
├── apps/
│   ├── api/                        # Hono backend API (Port 3001)
│   │   ├── src/app.ts              # App composition mounting domain routes, audit logs & CORS
│   │   ├── src/env.ts              # Zod runtime env validation (fail-fast in production)
│   │   ├── src/lib/
│   │   │   ├── audit.ts            # PostgreSQL audit_log writer & sensitive read path helpers
│   │   │   ├── auth/               # Better Auth setup, Turnstile captcha, org lifecycle
│   │   │   ├── hc/                 # Type-only Hono RPC client exporter (`@workspace/api/hc`)
│   │   │   ├── redis/              # Shared IORedis client, BullMQ producer & atomic rate-limit scripts
│   │   │   ├── create-hono-app.ts  # Standard response envelopes, secure headers & CORS
│   │   │   ├── errors.ts           # Typed AppError subclasses
│   │   │   ├── ip.ts               # Trusted proxy matching & client IP resolution
│   │   │   ├── storage.ts          # Safe key generation & shared storage re-exports
│   │   │   └── tenant.ts           # Drizzle tenant query helpers (withOrg, scopedWhere)
│   │   ├── src/middleware/         # Request ID, auth/ban, rate limit, tenant boundary, RBAC, audit
│   │   └── src/modules/
│   │       ├── ai/                 # Mastra /api/ai/* chat stream, agents & tenant thread history
│   │       ├── auth/               # Better Auth handler with per-endpoint rate limiting
│   │       ├── email/              # Typed BullMQ (or dev inline) email producer
│   │       ├── health/             # /api/health, /api/health/live, /api/health/ready
│   │       ├── notification/       # In-app notifications, preferences, Web Push & BullMQ producer
│   │       ├── organization/       # Active org lookup, profile updates, member removal & ownership transfer
│   │       └── storage/            # Private S3/R2/MinIO presign, commit, stream/URL, quota & delete
│   ├── web/                        # Next.js 16 App Router web app (Port 3000)
│   │   ├── .env.example            # Strictly web-scoped env template (copied to apps/web/.env)
│   │   ├── public/sw.js            # Web Push Service Worker (push + safe notification click)
│   │   ├── src/app/api/[...path]/  # Streaming runtime Route Handler proxying to INTERNAL_API_URL
│   │   ├── src/app/dashboard/ai/   # Tenant-scoped Mastra streaming chat UI (@ai-sdk/react)
│   │   ├── src/app/dashboard/settings/ # Workspace settings (general, members, roles, notifications, advanced)
│   │   ├── src/app/onboarding/     # New-user workspace creation onboarding flow
│   │   ├── src/components/         # AppHeader, BrandMark & SiteFooter
│   │   ├── src/env.ts              # Browser-safe publicWebEnv & server env validation
│   │   ├── src/proxy.ts            # Optimistic cookie guard matching /dashboard/:path* and /onboarding
│   │   └── src/lib/                # Hono RPC client, Better Auth client, server session & org hooks
│   └── worker/                     # Dedicated BullMQ worker process (Port 3002 probes)
├── packages/
│   ├── ai-core/                    # Mastra agents, tools, workflows, @mastra/pg & browser contracts
│   ├── db/                         # Drizzle ORM schemas (public), pgvector init/migrations & seed
│   ├── shared/                     # Leaf shared contracts (@workspace/shared/{config,logger,network,permissions,queues,storage})
│   └── ui/                         # Tailwind CSS v4 tokens, components, auth flows, brand icons & notifications
├── .github/workflows/ci.yml        # CI pipeline (check, check-types, test, build)
├── Dockerfile.api / web / worker   # Multi-stage non-root Alpine Dockerfiles using turbo prune
└── docker-compose.yml              # Localhost-bound pgvector/pgvector:pg16, Redis 7 & MinIO services
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Bun** (`v1.4+`): `curl -fsSL https://bun.sh/install | bash`
- **PostgreSQL 16 with `pgvector`** (`pgvector/pgvector:pg16`), **Redis 7**, and optional **MinIO** (or start locally via `docker compose up -d`)

### 2. Install Dependencies
```bash
bun install
```

### 3. Environment Variables
```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```
- **Root `.env`** holds backend secrets (Postgres, Redis, `BETTER_AUTH_SECRET`, S3/MinIO, Resend, VAPID, AI provider keys). Local MinIO defaults match `docker-compose.yml`.
- **`apps/web/.env`** is isolated to web-only configuration (`INTERNAL_API_URL`, `NEXT_PUBLIC_*`) so server secrets are never bundled into Next.js standalone outputs.
- Set an [AI provider key](#-ai-providers) in root `.env` to enable live chat in `/dashboard/ai` and Mastra Studio. Workspace summaries use workspace credits granted by a platform admin in `/admin/organizations`.

### 4. Push Schema & Start Development
```bash
bun run db:push
bun run db:seed
bun run dev
```
- **Next.js Web**: `http://localhost:3000` (dev seed credentials: `admin@acme.example` / `Password123!`)
- **Hono API**: `http://localhost:3001`
- **BullMQ Worker Probes**: `http://localhost:3002/healthz` and `http://localhost:3002/readyz`

---

## 🛠 Available Scripts

| Command | Action |
|---|---|
| `bun run setup` | Initialize project name, APP_CONFIG branding, `.env`, and `apps/web/.env` |
| `bun run dev` | Start Web, API, and Worker via Turborepo |
| `bun run dev:ai` | Launch Mastra Studio (`mastra dev`) for `@workspace/ai-core` |
| `bun run dev:web` | Start only the Next.js frontend |
| `bun run dev:api` | Start only the Hono backend |
| `bun run dev:worker` | Start the BullMQ background worker service |
| `bun run build` | Build all apps and packages |
| `bun run check` | Run Ultracite/Biome checks across all workspaces |
| `bun run fix` | Auto-format and fix linting issues |
| `bun run check-types` | Run TypeScript checks across all workspaces |
| `bun run test` | Run automated Bun test suite |
| `bun run db:push` | Push Drizzle schema to PostgreSQL |
| `bun run db:generate` | Generate Drizzle SQL migrations |
| `bun run db:migrate` | Run pending database migrations |
| `bun run db:seed` | Seed demo user/org (`admin@acme.example`), storage quota & notification preferences |
| `bun run db:studio` | Launch Drizzle Studio GUI |

---

## 🤖 AI Providers

The Mastra workspace (`packages/ai-core`) uses Mastra's `provider/model` router so you can switch chat models without code changes. Only the API key for the provider(s) you use is required in `.env`:

| Provider | Example `MASTRA_DEFAULT_MODEL` | API Key Env Var(s) | Embeddings (`MASTRA_EMBEDDING_MODEL`) |
|---|---|---|---|
| **Google Gemini** *(default)* | `google/gemini-3.5-flash-lite` | `GOOGLE_GENERATIVE_AI_API_KEY` *(or `GOOGLE_API_KEY`)* | `google/gemini-embedding-001` |
| **OpenAI** | `openai/gpt-5-mini` | `OPENAI_API_KEY` | `openai/text-embedding-3-small`, `openai/text-embedding-3-large` |
| **Anthropic** | `anthropic/claude-sonnet-4-5` | `ANTHROPIC_API_KEY` | Use a `google/*` or `openai/*` embedder *(or omit for thread-only memory)* |
| **OpenRouter** | `openrouter/anthropic/claude-sonnet-4.5` | `OPENROUTER_API_KEY` | Use a `google/*` or `openai/*` embedder *(or omit for thread-only memory)* |

- **Decoupled embeddings:** `MASTRA_EMBEDDING_MODEL` (`google/*` or `openai/*`) is independent of `MASTRA_DEFAULT_MODEL`. If the embedding provider's key is missing, thread history still persists in PostgreSQL and semantic recall is automatically disabled.
- **pgvector dimension limit:** `MASTRA_EMBEDDING_DIMENSIONS` defaults to `768` and must be `<= 2000` (pgvector HNSW limit).

---

## 🏛️ Key Architecture Notes

1. **Leaf Shared Contracts (`@workspace/shared/{config,logger,network,permissions,queues,storage}`)**:
   - Concrete, runtime-neutral modules in `packages/shared/src/` shared by `apps/api`, `apps/web`, `apps/worker`, and `packages/db`. Export paths use `"default"` conditions so both Bun and Node tooling (`drizzle-kit`) resolve cleanly.
2. **Authentication, Tenant Isolation & Dynamic RBAC**:
   - `apps/api/src/lib/auth/index.ts` configures Better Auth with Drizzle ORM (`organizationRole`), Redis `secondaryStorage`, hashed Email OTPs (`storeOTP: "hashed"`), `requireEmailVerification: true`, and `organization({ ac, roles, dynamicAccessControl: { enabled: true } })`.
   - `createTenantBoundaryMiddleware` enforces strict active-organization matching across route params, query strings, and `x-organization-id` headers.
   - `hasOrgPermission` delegates permission checks to `auth.api.hasPermission(...)` with per-request caching on Hono context.
   - `POST /api/organizations/transfer-ownership` transfers ownership atomically from `owner` to an active `admin`.
3. **Private Multi-Tenant Storage (`apps/api/src/modules/storage/`)**:
   - Uses S3/R2/MinIO presigned PUT uploads, `HeadObject` size/MIME verification on commit, row-locked per-organization storage quotas, and private file streaming / short-lived signed downloads.
   - Buckets remain private by default; SVG uploads (`image/svg+xml`) are rejected to prevent stored XSS.
4. **Multi-Channel Notifications (`apps/api/src/modules/notification/` & `apps/worker`)**:
   - Supports in-app, Resend HTML email (with console preview in `NODE_ENV=development` when `RESEND_API_KEY` is unset), and Web Push via `web-push` (`apps/web/public/sw.js`). Set `QUEUE_DRIVER="inline"` in local dev to skip Redis email queueing if running without `apps/worker`.
5. **Web Routing & Next.js Proxy (`apps/web`)**:
   - `apps/web/src/proxy.ts` performs optimistic session cookie checks for `["/dashboard/:path*", "/onboarding"]`; Server Components verify sessions via `getServerSession()`.
   - `apps/web/src/app/api/[...path]/route.ts` streams all `/api/*` requests to runtime `getInternalApiUrl()` (`INTERNAL_API_URL || NEXT_PUBLIC_API_URL || "http://localhost:3001"`) preserving multi-`Set-Cookie` headers and SSE streams with no 30s timeout.
6. **Mastra AI, Tenant Memory & `pgvector` Isolation (`packages/ai-core`, `/api/ai/*`, `/dashboard/ai`)**:
   - `packages/ai-core` defines `workspace-assistant`, `AI_PROVIDERS`, `workspace-brief` workflow, and read-only Drizzle tools (`workspaceContextTool`, `workspaceMembersTool`, `workspaceFilesTool`) scoped strictly via `RequestContext`.
   - `@mastra/pg` (`PostgresStore` + `PgVector`) persists state inside `MASTRA_DB_SCHEMA` (`mastra`), isolated from Drizzle's `schemaFilter: ["public"]`.

---

## License

MIT
