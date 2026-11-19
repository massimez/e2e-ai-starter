# ISO/IEC 27001:2022 Enterprise Readiness Design (`e2e-ai-starter`)

- **Date:** 2026-11-19
- **Status:** Draft (Pending User Approval)
- **Selected Approach:** Approach B — Full Enterprise Suite

---

## 1. Intent & Why

Teams adopting `e2e-ai-starter` for B2B SaaS and AI applications frequently face **ISO/IEC 27001:2022** certification or enterprise customer security reviews early in their lifecycle. While the starter already provides strong multi-tenant isolation (`tenantBoundaryMiddleware`), dynamic RBAC (`Better Auth`), private S3 storage, SSRF protection, per-request CSP nonces, and an `audit_log` writer, several controls required by ISO 27001 Annex A are either half-wired (e.g., `audit:read` and `audit:export` permissions exist in `@workspace/shared/permissions` with no API or UI) or missing (TOTP MFA, active session management, append-only audit protection, field-level token encryption, automated data retention, CI vulnerability auditing, and Statement of Applicability documentation).

This design completes those controls end-to-end while preserving the repository's core portability principle (`D1` in `docs/DECISIONS.md`): **zero-friction local development (`bun run dev` and `admin@acme.example` seed login work out of the box without external cloud KMS dependencies).**

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
1. **Audit Trail Completeness & Immutability (ISO A.8.15, A.8.16, A.5.33)**
   - Enforce append-only immutability on `audit_log` via a PostgreSQL trigger that blocks `UPDATE` and blocks `DELETE` unless `SET LOCAL app.audit_retention_prune = 'on'` is set by the authorized retention transaction.
   - Record support impersonation attribution (`impersonatedBy: session?.impersonatedBy`) in `auditMiddleware`.
   - Expose `/api/audit` (`GET /` for filtered cursor/page listing with `audit:read`, `GET /export` for CSV/JSON export with `audit:export`) and a `/dashboard/settings/audit` UI page.
2. **TOTP Multi-Factor Authentication & Session Lifecycle (ISO A.8.5, A.5.18)**
   - Enable Better Auth's `twoFactor` plugin (`twoFactor` table + `user.twoFactorEnabled` column) with TOTP authenticator and backup code verification in the Auth Modal and enrollment in `/dashboard/settings/security`.
   - Configure explicit session lifetimes (`SESSION_EXPIRES_IN_SECONDS` default 7 days, `SESSION_UPDATE_AGE_SECONDS` default 24 hours) and provide an active device session list with individual and bulk session revocation in `/dashboard/settings/security`.
3. **Cryptography at Rest & in Transit (ISO A.8.24)**
   - Provide an AES-256-GCM envelope encryption module in `@workspace/shared/crypto` using HKDF-SHA256 key derivation from `ENCRYPTION_SECRET` (falling back to `BETTER_AUTH_SECRET`).
   - Encrypt sensitive secrets at rest: OAuth tokens (`account.accessToken`, `account.refreshToken`, `account.idToken`) and Web Push keys (`pushSubscription.keys`), remaining backward-compatible with plaintext dev/test fixtures via `enc:v1:` prefix detection.
   - Enforce `https://` origins and `DATABASE_SSL` in `apps/api/src/env.ts` when `NODE_ENV === "production"` (excluding localhost/127.0.0.1).
4. **Automated Data Retention Lifecycle (ISO A.8.10, A.5.33)**
   - Add a repeatable daily BullMQ retention job in `apps/worker` (`retention-queue`) that prunes expired `verification` tokens, expired `invitation` rows, abandoned `pending` `uploads`, old read `notification` rows (`NOTIFICATION_RETENTION_DAYS`, default 90), and `audit_log` rows older than `AUDIT_RETENTION_DAYS` (default 365).
5. **DevSecOps CI Pipeline & ISO 27001 Compliance Pack (ISO A.8.7, A.8.8, A.8.25, A.8.28, A.5.1, A.6.8)**
   - Add dependency vulnerability scanning (`bun audit`) to `.github/workflows/ci.yml`.
   - Ship `SECURITY.md`, `docs/compliance/ISO-27001-SOA.md` (Statement of Applicability mapped to exact repo files/tests), and `docs/compliance/DATA-LIFECYCLE.md`.

### Non-Goals
- Organizational GRC workflows outside application scope (HR onboarding checklists, physical office security, vendor procurement workflows).
- Hard dependency on cloud-specific KMS SDKs (AWS KMS / GCP KMS) that would prevent booting the stack locally with `docker compose up -d`.

### Anti-Goals
- **Never break local onboarding**: `admin@acme.example` (`Password123!`) must still sign in without mandatory MFA in development; MFA is opt-in per user by default.
- **Never leak backend secrets into `apps/web`**: All cryptographic operations and env vars (`ENCRYPTION_SECRET`, `BETTER_AUTH_SECRET`) remain strictly server-side (`apps/api`, `apps/worker`, `@workspace/shared/crypto` imported only by backend workspaces).

---

## 3. Constraints & Package Boundaries

- **Leaf Shared Package (`@workspace/shared`)**: New `./crypto` subpath export in `packages/shared/package.json` using `"default"` export conditions for Bun and Node (`drizzle-kit`) compatibility. Uses only built-in `node:crypto`.
- **Database Schema (`@workspace/db`)**: Remains in `public` schema (`schemaFilter: ["public"]`). New migration `packages/db/migrations/0007_iso27001_controls.sql` adds the `two_factor` table, `user.two_factor_enabled` column, and the `audit_log` immutability trigger.
- **Typed Hono RPC (`@workspace/api/hc`)**: The new `auditRoutes` router is chained onto `app` in `apps/api/src/app.ts` so `apps/web` gets full end-to-end RPC typing via `client.api.audit`.
- **Code Quality**: All code must pass Ultracite/Biome (`bun run fix`, `bun run check`), strict TypeScript (`bun run check-types`), and Bun test suites (`bun run test`).

---

## 4. Approaches Considered

1. **Approach A — Core Technical Controls + Compliance Evidence Pack**
   - Included `/api/audit` + UI, session TTL & active session revocation UI, production TLS checks, worker retention jobs, CI security checks, and ISO 27001 docs, while omitting TOTP MFA, DB immutability triggers, and field encryption.
   - *Trade-off*: Simpler auth and DB schema, but leaves gaps on A.8.5 (MFA), A.8.15 (DB-level log tamper protection), and A.8.24 (application-layer secret encryption at rest).
2. **Approach B — Full Enterprise Suite (Selected)**
   - Combines all of Approach A with Better Auth `twoFactor()` TOTP MFA + backup codes, PostgreSQL append-only trigger protection on `audit_log`, and AES-256-GCM field encryption for stored OAuth tokens and Web Push keys.
   - *Why selected*: Provides complete, defense-in-depth technical evidence across all applicable ISO/IEC 27001:2022 Annex A controls while keeping MFA and encryption progressive so local development remains effortless.
3. **Approach C — Documentation & CI Hardening Only**
   - Added only `SECURITY.md`, SoA docs, and CI checks.
   - *Trade-off*: Rejected because it left declared RBAC permissions (`audit:read`, `audit:export`) unimplemented.

---

## 5. Detailed Technical Design

### 5.1 Track 1: Append-Only Audit Log, Impersonation Attribution & `/api/audit` Module

#### Database Immutability Trigger (`packages/db/migrations/0007_iso27001_controls.sql`)
- Create a PL/pgSQL trigger function `prevent_audit_log_mutation()`:
  - On `UPDATE`: Always `RAISE EXCEPTION 'audit_log is append-only and cannot be updated' USING ERRCODE = '55000'`.
  - On `DELETE`: Check ` coalesce(current_setting('app.audit_retention_prune', true), '') = 'on'`. If not `'on'`, `RAISE EXCEPTION 'audit_log rows cannot be deleted outside retention pruning' USING ERRCODE = '55000'`.
- Note on `user.id` foreign key: `audit_log.user_id` currently has `ON DELETE SET NULL`. Because a `DELETE FROM "user"` cascades a `SET NULL` `UPDATE` onto `audit_log`, the `BEFORE UPDATE` trigger allows an update **only** when the sole changed column is `user_id` transitioning from `OLD.user_id IS NOT NULL` to `NEW.user_id IS NULL` (preserving referential integrity when a user account is deleted while keeping `action`, `details`, `entity_id`, `entity_type`, `organization_id`, `ip_address`, `user_agent`, and `created_at` strictly immutable).

#### Impersonation Attribution (`apps/api/src/middleware/audit.ts` & `packages/db/src/schema/audit.ts`)
- Extend `SessionActor` in `apps/api/src/middleware/audit.ts` with `impersonatedBy?: string | null` and `AuditLogDetails` in `packages/db/src/schema/audit.ts` with `impersonatedBy?: string`.
- When `session?.impersonatedBy` is present, include `impersonatedBy: session.impersonatedBy` in `record.details`.

#### Audit API Module (`apps/api/src/modules/audit/`)
- **`schema.ts`**:
  - `listAuditLogsQuerySchema`: `page` (default 1), `limit` (1–100, default 25), `action` (optional string prefix/exact), `entityType` (optional string), `userId` (optional string), `search` (optional string up to 120 chars), `from` (optional ISO datetime/date), `to` (optional ISO datetime/date).
  - `exportAuditLogsQuerySchema`: same filters as list + `format: z.enum(["csv", "json"]).default("csv")`, `limit: z.coerce.number().int().min(1).max(5000).default(1000)`.
- **`service.ts`**:
  - `listOrganizationAuditLogs({ organizationId, query })`: Queries `auditLog` left-joined with `user` (`actorName`, `actorEmail`) scoped strictly via `withOrg(auditLog, organizationId, ...)`, ordered by `desc(auditLog.createdAt)`.
  - `exportOrganizationAuditLogs({ organizationId, query })`: Fetches up to `query.limit` matching rows and formats either a deterministic RFC 4180 CSV (with CSV injection formula escaping for leading `=`, `+`, `-`, `@`, `\t`, `\r`) or a JSON payload.
- **`route.ts`**:
  - Mounted at `.route("/audit", auditRoutes)` in `apps/api/src/app.ts`.
  - Uses `authMiddleware`, `tenantBoundaryMiddleware`, and `rateLimiter(60_000, 60, { identity: "actor" })`.
  - `GET /` guarded by `hasOrgPermission("audit:read")`.
  - `GET /export` guarded by `hasOrgPermission("audit:export")` and `rateLimiter(60_000, 10, { identity: "actor", operation: "audit:export" })`. Returns `Content-Type: text/csv; charset=utf-8` or `application/json; charset=utf-8` with `Content-Disposition: attachment; filename="audit-logs-<orgId>-<date>.<ext>"`.

#### Web Settings Audit Log UI (`apps/web/src/app/dashboard/settings/audit/page.tsx`)
- Add React Query hooks `useOrganizationAuditLogs` and `exportOrganizationAuditLogs` in `apps/web/src/lib/audit-hooks.ts`.
- Add `"Audit Logs"` tab (`FileSearch` or `ScrollText` icon) to `SettingsNav` and a card to `SettingsIndexPage`.
- Render search bar, action/date filters, paginated table showing Timestamp, Actor (with impersonation badge if `details.impersonatedBy` is set), Action badge, Target Entity, IP Address, HTTP Status/Duration, expandable JSON details drawer/dialog, and `"Export CSV"` / `"Export JSON"` buttons (enabled when the user holds `audit:export`).

---

### 5.2 Track 2: TOTP Multi-Factor Authentication & Session Management

#### Schema (`packages/db/src/schema/user.ts` & `packages/db/src/schema/session.ts`)
- In `user`: add `twoFactorEnabled: boolean("two_factor_enabled").default(false)`.
- In `session.ts`: add `twoFactor` table matching Better Auth's `twoFactor` plugin schema:
  - `id: text("id").primaryKey()`
  - `secret: text("secret").notNull()`
  - `backupCodes: text("backup_codes").notNull()`
  - `userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" })`
  - Index `twoFactor_userId_idx` on `userId` and `twoFactor_secret_idx` on `secret`.

#### Better Auth Server & Client (`apps/api/src/lib/auth/index.ts`, `apps/web/src/lib/auth-client.ts`)
- In `apps/api/src/lib/auth/index.ts`:
  - Pass `twoFactor: schema.twoFactor` into `drizzleAdapter(db, { schema: { ... } })`.
  - Add `twoFactor({ issuer: APP_CONFIG.name })` to `plugins`.
  - Configure `session: { cookieCache: { enabled: false }, expiresIn: env.SESSION_EXPIRES_IN_SECONDS, storeSessionInDatabase: true, updateAge: env.SESSION_UPDATE_AGE_SECONDS }`.
- In `apps/api/src/env.ts`:
  - `SESSION_EXPIRES_IN_SECONDS`: default `604_800` (7 days), min `300`.
  - `SESSION_UPDATE_AGE_SECONDS`: default `86_400` (24 hours), min `60`.
- In `apps/web/src/lib/auth-client.ts`:
  - Add `twoFactorClient()` from `"better-auth/client/plugins"`.

#### Auth Modal 2FA Sign-In Challenge (`packages/ui/src/components/auth/auth-modal-provider.tsx`)
- Extend `AuthModalClient` with optional `twoFactor?: { verifyTotp: (input: { code: string; trustDevice?: boolean }) => Promise<AuthResponseLike>; verifyBackupCode?: (input: { code: string }) => Promise<AuthResponseLike> }`.
- In `handleSignIn`: when `signIn.email` succeeds with `(ctx.data as { twoFactorRedirect?: boolean } | undefined)?.twoFactorRedirect === true`, transition `view` to `"twoFactorOtp"` using the existing `OtpVerification` primitive (6-digit TOTP input) and call `authClient.twoFactor.verifyTotp({ code: otp })`.

#### Security & Active Sessions Settings UI (`apps/web/src/app/dashboard/settings/security/page.tsx`)
- Add `"Security & Sessions"` tab (`KeyRound` / `Lock` icon) to `SettingsNav` and a card to `SettingsIndexPage`.
- **Section 1 — Two-Factor Authentication (TOTP)**:
  - Shows current 2FA status badge (`Enabled` / `Disabled` from `session.user.twoFactorEnabled`).
  - Enable flow: prompts for account password $\rightarrow$ calls `authClient.twoFactor.enable({ password })` $\rightarrow$ displays the `totpURI` (rendered as an inline SVG QR code via a lightweight zero-dependency SVG matrix or copyable setup key + `otpauth://` link) and backup codes $\rightarrow$ prompts for a 6-digit TOTP code to call `authClient.twoFactor.verifyTotp({ code })` and confirm enrollment.
  - Disable flow: prompts for account password $\rightarrow$ calls `authClient.twoFactor.disable({ password })`.
- **Section 2 — Active Device Sessions**:
  - Lists active sessions via `authClient.listSessions()` showing IP address, parsed browser/OS from `userAgent`, created/expires timestamps, and a `"Current Session"` badge.
  - Provides `"Revoke"` on individual sessions (`authClient.revokeSession({ token })`) and `"Revoke All Other Sessions"` (`authClient.revokeOtherSessions()`).

---

### 5.3 Track 3: Application-Level AES-256-GCM Envelope Encryption & Production TLS Enforcement

#### Envelope Encryption (`packages/shared/src/crypto.ts`)
- Exported as `@workspace/shared/crypto`.
- Prefix format: `enc:v1:<12-byte-iv-base64url>:<16-byte-tag-base64url>:<ciphertext-base64url>`.
- Key derivation: `hkdfSync("sha256", rawSecret, "e2e-ai-starter-field-encryption-v1", "aes-256-gcm", 32)` where `rawSecret` is at least 32 characters.
- API:
  - `isEncryptedValue(value: string | null | undefined): boolean`
  - `encryptSecretValue(plaintext: string, secretKey: string): string` (idempotent: if `isEncryptedValue(plaintext)` is already true, returns as-is).
  - `decryptSecretValue(value: string, secretKey: string): string` (if `!isEncryptedValue(value)`, returns `value` as-is for backward compatibility with unencrypted dev rows; otherwise decrypts and verifies GCM auth tag).
  - `encryptNullableSecret(value: string | null | undefined, secretKey: string): string | null | undefined`
  - `decryptNullableSecret(value: string | null | undefined, secretKey: string): string | null | undefined`

#### Wiring Encryption at Rest
- **`ENCRYPTION_SECRET` env var** in `apps/api/src/env.ts` and `apps/worker/src/env.ts`: optional 32+ char string that defaults to `BETTER_AUTH_SECRET` when unset (and rejects the default dev fallback secret in production).
- **OAuth Account Tokens (`apps/api/src/lib/auth/index.ts`)**:
  - Add `databaseHooks.account.create.before` and `databaseHooks.account.update.before` to encrypt `accessToken`, `refreshToken`, and `idToken` with `env.ENCRYPTION_SECRET` before persisting to PostgreSQL.
- **Web Push Subscription Keys (`apps/api/src/modules/notification/service.ts` & `apps/worker/src/processors/notification.ts`)**:
  - Encrypt `keys.auth` and `keys.p256dh` on `upsertPushSubscription` before storing in `push_subscription`.
  - Decrypt `keys.auth` and `keys.p256dh` in `apps/worker` before invoking `webpush.sendNotification(...)`.

#### Production TLS & Origin Validation (`apps/api/src/env.ts`)
- In `createApiEnvSchema` `superRefine` when `data.NODE_ENV === "production"`:
  - Require `BETTER_AUTH_URL` and `CORS_ORIGIN` entries to use `https://` unless the hostname is `localhost` or `127.0.0.1`.
  - Require `DATABASE_SSL === true` or `DATABASE_URL.includes("sslmode=require")` unless `DATABASE_URL` hostname is `localhost` or `127.0.0.1`.

---

### 5.4 Track 4: Automated Data Retention Worker (`apps/worker`)

- **Shared Queue Contract (`packages/shared/src/queues.ts`)**:
  - `export const RETENTION_QUEUE_NAME = "retention-queue";`
  - `export const retentionJobDataSchema = z.object({ triggeredBy: z.enum(["schedule", "manual"]).default("schedule") });`
- **Environment Config (`apps/worker/src/env.ts` & `apps/api/src/env.ts`)**:
  - `AUDIT_RETENTION_DAYS`: `z.coerce.number().int().min(1).max(3650).default(365)`
  - `NOTIFICATION_RETENTION_DAYS`: `z.coerce.number().int().min(1).max(3650).default(90)`
- **Retention Processor (`apps/worker/src/processors/retention.ts`)**:
  - Executes 5 deterministic cleanup operations and logs a structured summary:
    1. Delete expired `verification` rows (`expiresAt < now`).
    2. Delete expired `invitation` rows (`status = 'pending' AND expiresAt < now - 30 days`, and mark `status = 'expired'` where `status = 'pending' AND expiresAt < now`).
    3. Mark abandoned `pending` `uploads` as `failed` where `expiresAt < now - 1 hour`.
    4. Delete read `notification` rows (`isRead = true AND createdAt < now - NOTIFICATION_RETENTION_DAYS`).
    5. Delete expired `audit_log` rows (`createdAt < now - AUDIT_RETENTION_DAYS`) inside `db.transaction` after executing `SET LOCAL app.audit_retention_prune = 'on'`.
- **Worker Registration (`apps/worker/src/index.ts`)**:
  - Register `retentionWorker` on `RETENTION_QUEUE_NAME`, include it in `/healthz` and graceful `shutdown()`, and schedule a daily repeatable job (`0 3 * * *`) on startup.

---

### 5.5 Track 5: CI DevSecOps & ISO 27001 Compliance Evidence Pack

- **CI Pipeline (`.github/workflows/ci.yml`)**:
  - Add a security audit step (`bun audit --audit-level=high` with explicit exit check) and verify lockfile integrity.
- **Compliance & Security Documentation**:
  - `SECURITY.md`: Vulnerability reporting procedure, response targets, disclosure policy, and high-level security controls overview (ISO A.6.8, A.5.24).
  - `docs/compliance/ISO-27001-SOA.md`: Complete Statement of Applicability mapping ISO/IEC 27001:2022 Annex A controls (A.5, A.6, A.7, A.8) to implementation status, exact repository file paths, and verification commands.
  - `docs/compliance/DATA-LIFECYCLE.md`: Data asset inventory, encryption at rest/in transit matrix, cascading deletion matrix (including `mastra` vector store & S3 cleanup), and automated retention schedules.

---

## 6. Builder Decisions (Settled Defaults)

- **QR Code Rendering for TOTP Setup**: To avoid adding third-party browser dependencies that could bloat `apps/web` or introduce supply-chain drift, `/dashboard/settings/security` displays the formatted secret key, one-click copy, and an `otpauth://` URI launcher link alongside a clean pure-TypeScript/SVG representation (or standard authenticator manual entry instructions), keeping dependencies zero-footprint.
- **CSV Injection Protection on Audit Export**: Cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` are prefixed with a single quote `'` before RFC 4180 quoting so exported CSVs are safe to open in Excel/Google Sheets.
- **Audit Log Immutability in Unit/Integration Tests**: Tests that clean up `audit_log` rows in `afterEach`/`beforeEach` can run `SET LOCAL app.audit_retention_prune = 'on'` inside a transaction (via a shared `pruneAuditLogsForTest` or retention helper) so both test isolation and append-only trigger tests pass cleanly.
