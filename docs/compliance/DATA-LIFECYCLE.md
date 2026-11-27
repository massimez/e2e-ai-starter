# Data Lifecycle, Encryption & Retention Matrix

This document inventories application data stores, cryptographic protections, cascading deletion behavior, and automated retention schedules (aligned with ISO/IEC 27001:2022 A.5.33, A.8.10, and A.8.24).

## 1. Data Asset & Encryption Matrix

| Data Store / Table | Classification | Encryption in Transit | Encryption at Rest (Application Layer) | Notes |
|---|---|---|---|---|
| `user` | PII / Account | TLS (`DATABASE_SSL=true` in prod) | Infrastructure / DB disk | Passwords stored in `account.password` via Better Auth scrypt hashing |
| `account` (`accessToken`, `refreshToken`, `idToken`) | Secret / Credential | TLS | **Encrypted by Better Auth** (`account.encryptOAuthTokens: true`) | Automatically encrypted on write and decrypted on read/refresh using `BETTER_AUTH_SECRET` |
| `two_factor` (`secret`, `backupCodes`) | Secret / MFA | TLS | Encrypted by Better Auth using `BETTER_AUTH_SECRET` | TOTP secret & single-use recovery codes |
| `session` | Auth Token | HTTPS (`HttpOnly`, `SameSite`) + TLS | Infrastructure / DB + Redis | Lifetimes governed by `SESSION_EXPIRES_IN_SECONDS` (default 7d) & `SESSION_UPDATE_AGE_SECONDS` (default 24h) |
| `push_subscription` (`keys.auth`, `keys.p256dh`) | Secret / Device Key | HTTPS + TLS | **AES-256-GCM (`enc:v1:`)** via `@workspace/shared/crypto` | Encrypted on API save; decrypted in `apps/worker` before Web Push dispatch |
| `audit_log` | Security Record | TLS | Infrastructure / DB disk | Protected by PostgreSQL `audit_log_immutability_trigger` (append-only; pruned only via `SECURITY DEFINER` function `public.prune_expired_audit_logs` with a 30-day minimum floor) |
| `workspace_wallet`, `wallet_entry` | Internal credit activity | TLS | Infrastructure / DB disk | The wallet service records changes as new ledger entries. User deletion clears the ledger actor reference. |
| `uploads` / S3 Bucket | Tenant Content | HTTPS / TLS | Private bucket + server-side S3/R2 encryption | Soft-deleted in DB (`deleted_at`); private download streaming / short-lived signed URLs |
| `mastra` schema (`PostgresStore`, `PgVector`) | Tenant AI Memory & RAG | TLS | Infrastructure / DB disk | Isolated schema (`MASTRA_DB_SCHEMA`); strictly scoped by `${organizationId}:${userId}` and `{ organizationId }` vector metadata |

## 2. Automated Data Retention Schedule (`retention-queue`)

Registered by [apps/worker/src/index.ts](../../apps/worker/src/index.ts) on cron `0 3 * * *` (daily at 03:00 UTC) and executed by [apps/worker/src/processors/retention/index.ts](../../apps/worker/src/processors/retention/index.ts):

| Table | Condition | Action | Configurable Window |
|---|---|---|---|
| `verification` | `expires_at < now()` | Hard delete | Better Auth token TTL |
| `invitation` | `status = 'pending' AND expires_at < now()` | Update `status = 'expired'` | Invitation TTL |
| `invitation` | `status = 'expired' AND expires_at < now() - 30 days` | Hard delete | 30 days post-expiry |
| `uploads` | `status = 'pending' AND deleted_at IS NULL AND expires_at < now() - 1 hour` | Update `status = 'failed'` | 1 hour post-presign expiry |
| `notification` | `is_read = true AND created_at < now() - NOTIFICATION_RETENTION_DAYS` | Hard delete | `NOTIFICATION_RETENTION_DAYS` (default `90`) |
| `audit_log` | `created_at < now() - AUDIT_RETENTION_DAYS` | Hard delete via `public.prune_expired_audit_logs(integer)` (`SECURITY DEFINER`, 30-day floor) | `AUDIT_RETENTION_DAYS` (min `30`, default `365`) |

## 3. Cascading Deletion Matrix

| Lifecycle Event | Cascading Cleanup Behavior |
|---|---|
| **User deleted** | Cascades to `session`, `account`, `two_factor`, `member`, `notification`, `notification_preference`, `push_subscription`. `audit_log.user_id` is set to `NULL` (explicitly permitted by `prevent_audit_log_mutation()` while keeping all audit payload fields immutable), and `wallet_entry.actor_id` is set to `NULL`. |
| **Member removed / leaves org** | Removes `member` row and invokes `cleanupTenantAiMemory(organizationId, [userId])` to erase user-org AI threads & vector memory. |
| **Organization deleted** | Invokes `cleanupTenantAiMemory(organizationId, memberUserIds, { deleteOrganizationKnowledge: true })` before deleting organization, cascading to `member`, `invitation`, `organization_role`, `uploads`, `storage_folders`, `organization_storage_limits`, org `notification`, `workspace_wallet`, and `wallet_entry` rows. |
| **Uploaded file deleted** | Removes object from S3/R2, decrements `organization_storage_limits.current_usage`, removes indexed `PgVector` RAG chunks, and soft-deletes the `uploads` row. |
