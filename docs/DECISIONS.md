# Architecture Decisions Log (`DECISIONS.md`)

Lightweight ADR log for **major architectural or stack changes only** — so future engineers and AI sessions know *why* a core pattern exists and what was deliberately rejected.

**Log here only when:**
- Replacing or dropping a core framework, database, queue, auth, or AI orchestration pattern
- Introducing a non-obvious architectural boundary or "do not undo" constraint
- Recording major AI evaluation or cost baselines

**Skip** routine features, UI changes, refactors, and normal bug fixes (use git commits for those).

```markdown
## YYYY-MM-DD — <Area>

### D1. <Short title>
- **Context:** Why the default or earlier approach didn't fit.
- **Decision:** What was chosen or replaced (cite key paths/symbols).
- **Why:** Trade-off and what not to re-introduce.
```

## 2026-11-19 — Architecture Simplification & Starter Portability

### D1. Leaf `@workspace/shared`, Native Better Auth RBAC, Progressive Drivers & Web Env Isolation
- **Context:** `apps/web`, `apps/worker`, and `packages/db` imported runtime modules via `@workspace/api/*` subpaths; Better Auth's built-in `dynamicAccessControl` was disabled and reimplemented in `apps/api/src/modules/roles/` alongside phantom RBAC resources; Next.js `rewrites()` baked `INTERNAL_API_URL` at build time with a 30s proxy timeout; `apps/web/.env` symlinked to root `.env`; and local uploads failed when MinIO/S3 creds were absent.
- **Decision:**
  - Extract pure contracts to `packages/shared` (`@workspace/shared/{config,logger,network,permissions,queues,storage}` with `"default"` exports for Node `drizzle-kit` compatibility), leaving `@workspace/api/hc` as type-only `AppType`.
  - Use Better Auth native `organization({ ac, roles, dynamicAccessControl: { enabled: true } })`, Drizzle `organizationRole` (`packages/db/src/schema/organization.ts`), `auth.api.hasPermission` (`apps/api/src/middleware/org-permission.ts`), and `authClient.organization.*` (`apps/web/src/lib/organization-hooks.ts`), removing `apps/api/src/modules/roles/` while keeping `audit_log` + `auditMiddleware` for backoffice auditing.
  - Replace build-time `rewrites()` with a runtime streaming handler at `apps/web/src/app/api/[...path]/route.ts`, isolate web env vars into standalone `apps/web/.env`, and add `QUEUE_DRIVER=redis|inline` (`apps/api/src/modules/email/queue.ts`).
- **Why:** Eliminates circular/server-secret leaks into `.next/standalone`, removes duplicated custom RBAC glue, keeps SSR/SSE streaming resilient, and lets developers boot Web + API without MinIO. Do not re-introduce `@workspace/api/*` runtime subpaths, `apps/web/.env` root symlinks, or Next.js config `rewrites()` for `/api/*`.

