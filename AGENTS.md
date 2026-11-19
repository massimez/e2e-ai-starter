# Repository & Engineering Guidelines

## Project Structure & Module Organization

This is a Bun workspaces monorepo using Turborepo:
- `packages/shared`: Leaf shared package (`@workspace/shared`) with pure subpath exports (`config`, `logger`, `network`, `permissions`, `queues`, `storage`) using `"default"` export conditions for both Bun and Node tooling (`drizzle-kit`). Contains `APP_CONFIG`, Pino logger/redaction, SSRF IP checks, Better Auth RBAC `ac`/`roles`/`statements`, BullMQ queue schemas, and storage allowlists.
- `apps/api`: Hono API service running natively on Bun (Port 3001). Hosts Better Auth endpoints (`organization` + native `dynamicAccessControl`), `hasOrgPermission` (`auth.api.hasPermission`), tenant isolation middleware (`query`, `param`, `x-organization-id`), `auditMiddleware` (`audit_log`), organization ownership transfer, private S3/R2/MinIO object storage, BullMQ/inline queue producers (`QUEUE_DRIVER=redis|inline`), Mastra AI runtime endpoints (`/api/ai/*`), and notifications. Exposes type-only RPC via `@workspace/api/hc`.
- `apps/web`: Next.js 16 App Router web application (Port 3000) with Tailwind CSS v4, React 19, `src/proxy.ts` optimistic session routing guard (`["/dashboard/:path*", "/onboarding"]`), runtime streaming `/api/[...path]` proxy (`getInternalApiUrl()`), isolated `apps/web/.env` configuration (no backend secrets), typed Hono RPC client (`client`, `parseApiResponse`), Better Auth browser client (`authClient`), React Query organization hooks in `src/lib/`, `SiteFooter`, and `/dashboard/ai` streaming chat UI using `@ai-sdk/react`.
- `apps/worker`: Standalone BullMQ worker process (Port 3002 health probe server) processing `email` and `notification` queues (in-app, Resend/dev-preview email, Web Push via `web-push`).
- `packages/ai-core`: Mastra AI core workspace (`@workspace/ai-core`) containing `workspace-assistant` (`AI_PROVIDERS` registry), tenant-scoped `RequestContext` tools backed by `@workspace/db`, `@mastra/pg` (`PostgresStore` + `PgVector`) isolated in `MASTRA_DB_SCHEMA` (`mastra`), `workspace-brief` workflow, and browser-safe contracts (`@workspace/ai-core/contracts`).
- `packages/db`: Drizzle ORM schema (`schemaFilter: ["public"]`), SQL migrations (with `pgvector`), connection pool with HMR caching and graceful shutdown, relations, and seed script.
- `packages/ui`: Shared React components, auth modal/form flows, notification center, organization switcher, and brand icons.
- `.agents/skills`: Specialized agent skills for architecture, security, design, and Next.js best practices.
- `docs/specs`: Optional short design specs (`YYYY-MM-DD-<feature>-design.md`) for major or radical changes.
- `docs/DECISIONS.md`: Lightweight log of major architectural changes and replaced core tools (`D1`, `D2`, ...).

## Build, Test, and Development Commands

- `bun install`: Install workspace dependencies.
- `bun run dev`: Run Web, API, and Worker concurrently via Turborepo.
- `bun run dev:ai`: Run Mastra Studio (`mastra dev`) for `@workspace/ai-core`.
- `bun run dev:web` / `dev:api` / `dev:worker`: Run individual services.
- `bun run build`: Build all workspaces.
- `bun run check`: Run Ultracite/Biome quality checks across all files.
- `bun run fix`: Apply automatic Ultracite/Biome code and formatting fixes.
- `bun run check-types`: Run TypeScript checks across workspaces.
- `bun run test`: Run Bun test suite.
- `bun run db:push` / `db:generate` / `db:migrate` / `db:seed` / `db:studio`: Manage PostgreSQL schema & seed data.

## Coding Standards (Ultracite / Biome & TypeScript)

- **Formatting & Linting**: Biome via Ultracite with **tabs** and **double quotes**. Always run `bun run fix`, `bun run check`, and `bun run check-types` before finishing tasks.
- **TypeScript Strictness**: Strict mode enabled (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Prefer `unknown` over `any`, const assertions (`as const`) for literal tables, and type narrowing over assertions.
- **Code Style**: Use `const` by default, `let` only when reassigned, never `var`. Prefer `for...of` over `.forEach()`, template literals, optional chaining (`?.`), nullish coalescing (`??`), and early returns to keep nesting shallow.
- **React & Next.js**: Keep Server and Client boundaries clear. Pass `ref` directly in React 19 (no `forwardRef`). Call hooks unconditionally at the top level with exhaustive dependencies. Use semantic HTML (`<button type="button">`, `<dialog>`), explicit labels, keyboard navigation, and ARIA attributes.
- **Error Handling**: Never swallow errors silently. Catch, log with context, and rethrow or return typed error responses.
- **Naming Conventions**: Prefer kebab-case filenames (`auth-client.ts`, `sign-in.tsx`), PascalCase React components, and `useXxx` hooks.
- **Security & Data Rules**:
  - Guard protected API routes with `authMiddleware`, `hasOrgPermission`, and `tenantBoundaryMiddleware`, and validate all untrusted inputs and env schemas with Zod.
  - Keep object storage private (no SVG uploads), infer Drizzle row types via `typeof table.$inferSelect`, and populate Mastra `RequestContext` + `${organizationId}:${userId}` memory `resourceId` strictly server-side.
  - Declare every package dependency explicitly in its workspace `package.json` (`bunfig.toml` uses `linker = "isolated"`).
- **Package Boundaries**:
  - `apps/api` owns database persistence, Better Auth configuration, object storage access, and BullMQ job enqueueing.
  - `apps/web` reads only web-scoped variables from `apps/web/.env` and forwards `/api/*` via `apps/web/src/app/api/[...path]/route.ts`.
  - Shared constants/contracts live in `@workspace/shared/{config,logger,network,permissions,queues,storage}` — never import runtime code from `@workspace/api`.
  - `@workspace/ai-core` depends only on Mastra, AI SDK, Zod, Drizzle, and `@workspace/db` — never `@workspace/api`.

## Architecture Decisions Rule (Major Changes Only)

Skip `docs/DECISIONS.md` for routine features, UI edits, and normal bug fixes. Append a short `### D<n>. ...` entry to `docs/DECISIONS.md` **only** for major architectural pivots, replaced core tools/abstractions, non-obvious "do not undo" constraints, or major AI eval baselines — with **Context**, **Decision**, and **Why** citing exact file paths and symbol names.
