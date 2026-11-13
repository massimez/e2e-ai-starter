# e2e-ai-starter

A TypeScript Turborepo monorepo template powered by **Next.js 16 (App Router)**, **Hono API** (running natively on Bun), **Mastra AI** (Google Gemini, OpenAI, Anthropic, or OpenRouter + `pgvector` memory), **Better Auth** (with multi-tenant organizations, Email OTP, and RBAC), **Drizzle ORM** (PostgreSQL + `pgvector`), **BullMQ** (Redis background worker), **Tailwind CSS v4**, and pure subpath API exports (`@workspace/api/{config,hc,logger,permissions,queues,storage}`).

---

## Using as a Template

1. Create a new repository from this template (GitHub **Use this template** or `bun create <owner>/<repo> my-app`).
2. Initialize project branding, database/bucket defaults, and a fresh `BETTER_AUTH_SECRET`:
   ```bash
   bun run setup --name "My App" --slug my-app
   ```
   Running `bun run setup` updates [package.json](package.json), [apps/api/src/lib/app-config.ts](apps/api/src/lib/app-config.ts) (`APP_CONFIG`), [apps/web/src/app/icon.svg](apps/web/src/app/icon.svg), and creates `.env` from `.env.example` when missing (`--force-env` overwrites an existing `.env`).
3. [docker-compose.yml](docker-compose.yml) scopes container names per Compose project directory automatically, preventing collisions when running multiple cloned projects on one machine.
4. For advanced rebranding, edit `APP_CONFIG` in [apps/api/src/lib/app-config.ts](apps/api/src/lib/app-config.ts) and replace [apps/web/src/app/icon.svg](apps/web/src/app/icon.svg) / [apps/web/src/components/brand-mark.tsx](apps/web/src/components/brand-mark.tsx).

---

## ⚡ Tech Stack

| Domain | Technology |
|---|---|
| **Runtime & Monorepo** | [Bun](https://bun.sh) (workspaces, `isolated` linker, package catalog) & [Turborepo](https://turbo.build) |
| **API Subpath Contracts** | `@workspace/api/{permissions,queues,storage,hc}` (RBAC roles, queue names, notification categories/channels, storage allowlists, Hono RPC) |
| **Backend API** | [Hono](https://hono.dev) (running natively on Bun at `http://localhost:3001`) |
| **Frontend Web** | [Next.js 16](https://nextjs.org) (App Router, React 19 at `http://localhost:3000`, `src/proxy.ts`) |
| **Authentication** | [Better Auth](https://better-auth.com) (Drizzle adapter, Email/Password, Email OTP, optional Google OAuth, Organizations, RBAC) |
| **Database & Vector ORM** | [PostgreSQL 16 + pgvector](https://github.com/pgvector/pgvector) & [Drizzle ORM](https://orm.drizzle.team) (`schemaFilter: ["public"]`, isolated `mastra` AI schema) |
| **AI Agents & Memory** | [Mastra](https://mastra.ai) (`@workspace/ai-core`), multi-provider model router (Google Gemini default, OpenAI, Anthropic, OpenRouter; embeddings via Google or OpenAI), `@mastra/pg` (`PostgresStore` & `PgVector`), & [AI SDK](https://ai-sdk.dev) |
| **Worker & Queues** | [BullMQ](https://bullmq.io) & [Redis](https://redis.io) (isolated worker service in `apps/worker` + Web Push via `web-push`) |
| **Styling & UI** | [Tailwind CSS v4](https://tailwindcss.com), Lucide React, Sonner Toasts, Radix UI Primitives |
| **Linter & Formatter** | [Ultracite](https://github.com/biomejs/biome) / Biome |

---

## 📁 Repository Structure

```
e2e-ai-starter/
├── apps/
│   ├── api/                        # Hono backend API (Port 3001)
│   │   ├── src/app.ts              # App composition mounting domain routes, CORS & audit logging
│   │   ├── src/env.ts              # Zod runtime env validation (fail-fast in production)
│   │   ├── src/lib/
│   │   │   ├── auth/               # Better Auth setup & RBAC permissions (`@workspace/api/permissions`)
│   │   │   ├── hc/                 # hcWithType RPC client exporter
│   │   │   ├── redis/              # Shared IORedis client, BullMQ queues & atomic rate-limit scripts
│   │   │   ├── audit.ts            # Client IP resolution & fire-and-forget PostgreSQL audit logs
│   │   │   ├── create-hono-app.ts  # Standard response envelopes, secure headers & CORS
│   │   │   ├── errors.ts           # Typed AppError subclasses
│   │   │   ├── logger.ts           # Unified pretty/JSON logger & redaction (@workspace/api/logger)
│   │   │   ├── storage.ts          # Safe key generation & storage allowlist/size helpers
│   │   │   └── tenant.ts           # Drizzle tenant query helpers (withOrg, scopedWhere)
│   │   ├── src/middleware/         # Request ID, auth/ban, rate limit, tenant boundary, RBAC, audit
│   │   └── src/modules/
│   │       ├── ai/                 # Mastra /api/ai/* chat stream, agents & tenant thread history
│   │       ├── auth/               # Better Auth handler with per-endpoint rate limiting
│   │       ├── email/              # Typed BullMQ email queue producer
│   │       ├── health/             # /api/health, /api/health/live, /api/health/ready
│   │       ├── notification/       # In-app notifications, preferences, Web Push & BullMQ producer
│   │       ├── organization/       # Active org lookup & atomic ownership transfer
│   │       └── storage/            # Private S3/R2/MinIO presign, commit, stream/URL, quota & delete
│   ├── web/                        # Next.js 16 App Router web app (Port 3000)
│   │   ├── public/sw.js            # Web Push Service Worker (push + safe notification click)
│   │   ├── src/app/dashboard/ai/   # Tenant-scoped Mastra streaming chat UI (@ai-sdk/react)
│   │   ├── src/env.ts              # Browser-safe publicWebEnv & server env validation
│   │   ├── src/proxy.ts            # Optimistic cookie guard redirecting /dashboard/*
│   │   ├── src/lib/                # Hono RPC client, Better Auth client, server session & org hooks
│   │   ├── src/providers/          # ThemeProvider, QueryProvider & AuthModalProvider
│   │   └── next.config.ts          # /api/* rewrite, security headers & CSP
│   └── worker/                     # Dedicated BullMQ worker process (Port 3002 probes)
│       ├── src/env.ts              # Worker env schema (PostgreSQL, Redis, Resend, VAPID)
│       ├── src/index.ts            # Email & notification workers + /healthz & /readyz probes
│       └── src/processors/
│           ├── email/              # Verification OTP, welcome, invitation & password reset emails
│           └── notification/       # Multi-channel dispatcher (in-app, email, Web Push)
├── packages/
│   ├── ai-core/                    # Mastra agents, tools, workflows, @mastra/pg & browser contracts
│   ├── db/                         # Drizzle ORM schemas (public), pgvector init/migrations & seed
│   └── ui/                         # Tailwind CSS v4 tokens, components, auth flows, notifications & dropzone
├── .github/workflows/ci.yml        # CI pipeline (check, check-types, test, build)
├── Dockerfile.api / web / worker   # Multi-stage non-root Alpine Dockerfiles using turbo prune
└── docker-compose.yml              # Localhost-bound pgvector/pgvector:pg16, Redis 7 & MinIO services
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Bun** (`v1.3+`): `curl -fsSL https://bun.sh/install | bash`
- **PostgreSQL 16 with `pgvector`** (`pgvector/pgvector:pg16`), **Redis 7**, and optional **MinIO** (or start locally via `docker compose up -d`)

### 2. Install Dependencies
```bash
bun install
```

### 3. Environment Variables
```bash
cp .env.example .env
```
Review `.env.example` for API, Web, Worker, Database, Mastra AI (`MASTRA_DEFAULT_MODEL`, provider keys, `MASTRA_EMBEDDING_MODEL`, `MASTRA_EMBEDDING_DIMENSIONS`, `MASTRA_DB_SCHEMA`), Storage, and VAPID settings. Configure `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (e.g. from local MinIO, Cloudflare R2, or AWS S3) for direct presigned uploads, and the API key for your chosen AI provider (see [AI Providers](#ai-providers)) to enable live chat in `/dashboard/ai` and Mastra Studio; in production, real S3/R2/MinIO credentials, database/Redis URLs, a strong `BETTER_AUTH_SECRET`, and `RESEND_API_KEY` are enforced at startup.

### 4. Push Schema & Start Development
```bash
bun run db:push
bun run dev
```
- **Next.js Web**: `http://localhost:3000`
- **Hono API**: `http://localhost:3001`
- **BullMQ Worker Probes**: `http://localhost:3002/healthz` and `http://localhost:3002/readyz`

---

## 🛠 Available Scripts

| Command | Action |
|---|---|
| `bun run setup` | Initialize project name, APP_CONFIG branding, and `.env` secrets |
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
| `bun run db:seed` | Seed demo user/org, storage quota & default notification preferences |
| `bun run db:studio` | Launch Drizzle Studio GUI |

---

## 🤖 AI Providers

The Mastra workspace (`packages/ai-core`) uses Mastra's `provider/model` router so you can switch chat models without code changes. Only the API key for the provider(s) you use is required in `.env`:

| Provider | Example `MASTRA_DEFAULT_MODEL` | API Key Env Var(s) | Embeddings (`MASTRA_EMBEDDING_MODEL`) |
|---|---|---|---|
| **Google Gemini** *(default)* | `google/gemini-2.5-flash` | `GOOGLE_GENERATIVE_AI_API_KEY` *(or `GOOGLE_API_KEY`)* | `google/gemini-embedding-001` |
| **OpenAI** | `openai/gpt-5-mini` | `OPENAI_API_KEY` | `openai/text-embedding-3-small`, `openai/text-embedding-3-large` |
| **Anthropic** | `anthropic/claude-sonnet-4-5` | `ANTHROPIC_API_KEY` | Use a `google/*` or `openai/*` embedder *(or omit for thread-only memory)* |
| **OpenRouter** | `openrouter/anthropic/claude-sonnet-4.5` | `OPENROUTER_API_KEY` | Use a `google/*` or `openai/*` embedder *(or omit for thread-only memory)* |

- **Decoupled embeddings:** `MASTRA_EMBEDDING_MODEL` (`google/*` or `openai/*`) is independent of `MASTRA_DEFAULT_MODEL`. For example, you can chat with `anthropic/claude-sonnet-4-5` (`ANTHROPIC_API_KEY`) while semantic recall uses `openai/text-embedding-3-small` (`OPENAI_API_KEY`). If the embedding provider's key is not set, thread history still persists in PostgreSQL and semantic recall is automatically disabled.
- **pgvector dimension limit:** `MASTRA_EMBEDDING_DIMENSIONS` defaults to `768` and must be `<= 2000` (pgvector HNSW limit). Pick your embedding model and dimensions once; changing them after vectors are stored requires dropping or re-indexing the Mastra vector tables inside the `mastra` schema.

---

## 🏛️ Key Architecture Notes

1. **Shared API Contracts (`@workspace/api/permissions`, `@workspace/api/queues`, `@workspace/api/storage`)**:
   - Concrete `apps/api` modules (`src/lib/auth/permissions.ts`, `src/lib/queues.ts`, `src/modules/storage/config.ts`) exported as pure TypeScript subpath entrypoints (no Node/DB/Redis runtime dependencies) defining Better Auth access control (`ac`, `roles`: `owner`, `admin`, `member`, `viewer`, `PERMISSION_MATRIX`), queue identifiers, notification categories (`system`, `security`, `team`, `project`, `billing`) and channels (`in_app`, `email`, `push`), plus upload limits and MIME allowlists (excluding SVG).
2. **Authentication, Tenant Isolation & Governance**:
   - `apps/api/src/lib/auth/index.ts` configures Better Auth with Drizzle ORM, Redis `secondaryStorage`, hashed Email OTPs (`storeOTP: "hashed"`), `requireEmailVerification: true`, and asynchronous queued verification, reset-password, and organization invitation emails.
   - `createTenantBoundaryMiddleware` enforces strict active-organization matching across route params, query strings, `x-organization-id`, and JSON bodies.
   - `POST /api/organizations/transfer-ownership` executes an atomic transaction transferring ownership from the current `owner` to an active `admin` and demoting the previous owner to `admin`.
3. **Private Multi-Tenant Storage (`apps/api/src/modules/storage/`)**:
   - `POST /api/storage/presign`, `POST /api/storage/commit`, `GET /api/storage`, `GET /api/storage/usage`, `GET /api/storage/files/:id` (authenticated file stream), `GET /api/storage/files/:id/url` (short-lived presigned URL), `DELETE /api/storage/files/:id`, and `DELETE /api/storage`.
   - Buckets stay private by default; SVG uploads (`image/svg+xml`) are disallowed to prevent stored XSS.
4. **Multi-Channel Notifications (`apps/api/src/modules/notification/` & `apps/worker`)**:
   - `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`, `GET/PATCH /api/notifications/preferences`, `POST /api/notifications/push/subscribe`, `DELETE /api/notifications/push/unsubscribe`.
   - `apps/web/src/app/dashboard/settings/notifications/page.tsx` + `apps/web/public/sw.js` wire category/channel preferences and Web Push subscriptions when `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and worker VAPID keys are configured.
5. **Web Routing & Next.js Boundaries**:
   - `apps/web/src/proxy.ts` performs optimistic session cookie checks for `/dashboard/:path*`, while Server Components in `apps/web/src/app/dashboard/layout.tsx` validate sessions via `getServerSession()`.
   - `/accept-invitation` completes email organization invitations end-to-end.
   - `next.config.ts` rewrites `/api/*` to `INTERNAL_API_URL || NEXT_PUBLIC_API_URL || "http://localhost:3001"` and applies CSP and security response headers.
6. **Mastra AI, Tenant Memory & `pgvector` Isolation (`packages/ai-core`, `/api/ai/*`, `/dashboard/ai`)**:
   - `packages/ai-core` (`@workspace/ai-core` and browser-safe `@workspace/ai-core/contracts`) defines the provider-agnostic `workspace-assistant` agent (model from `MASTRA_DEFAULT_MODEL`), the `AI_PROVIDERS` registry, `workspace-brief` workflow, and read-only `get-workspace-context` Drizzle tool reading `organizationId` and `userId` strictly from Mastra `RequestContext`.
   - `@mastra/pg` (`PostgresStore` + `PgVector`) persists memory threads, semantic recall embeddings, and redacted observability traces inside `MASTRA_DB_SCHEMA` (`mastra`), isolated from Drizzle's `schemaFilter: ["public"]`.
   - `apps/api/src/modules/ai/` exposes `GET /api/ai/agents`, `POST /api/ai/chat` (AI SDK v7 SSE stream with heartbeat), `GET /api/ai/threads`, and `GET /api/ai/threads/:id`, gated by `authMiddleware`, `tenantBoundaryMiddleware`, and `hasOrgPermission("ai:read" | "ai:execute")` with threads scoped to `${organizationId}:${userId}`.
   - `apps/web/src/app/dashboard/ai/page.tsx` integrates `@ai-sdk/react` (`useChat` + `DefaultChatTransport`) on the same-origin `/api/ai/chat` rewrite.

---

## License

MIT: see [LICENSE](LICENSE).
