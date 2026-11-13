# Roadmap & TODO

## 1. User / Workspace AI Wallet & Token Top-Up Billing

Enable prepaid credit/token balances so users or organizations can top up their wallet and spend balance on AI chat, embeddings, and workflow runs.

- [ ] **Database Schema (`packages/db/src/schema/billing.ts`)**:
  - `ai_wallets`: `id`, `organizationId` (or `userId`), `balanceMicrocents` / `tokenBalance`, `currency`, `lowBalanceThreshold`, `updatedAt` with non-negative `CHECK (balance >= 0)` constraint.
  - `ai_wallet_transactions`: immutable append-only ledger (`id`, `walletId`, `type`: `"top_up" | "usage_debit" | "refund" | "grant"`, `amount`, `balanceAfter`, `model`, `promptTokens`, `completionTokens`, `requestId`, `threadId`, `metadata`, `createdAt`) with unique `idempotencyKey`.
- [ ] **Pre-Flight Balance Check & Cost Guard (`packages/ai-core` & `apps/api/src/modules/ai/`)**:
  - Reject `POST /api/ai/chat` and `POST /api/ai/workflows/*` with `402 Payment Required` (`AI_INSUFFICIENT_BALANCE`) when the active wallet balance is `<= 0`.
  - Wire Mastra's `TokenCostControl` processor or `onFinish` usage callback to meter `promptTokens` + `completionTokens` per model pricing table and atomically debit `ai_wallets` + insert an `ai_wallet_transactions` row inside a PostgreSQL transaction.
- [ ] **Top-Up & Payment Webhook Endpoints (`apps/api/src/modules/billing/`)**:
  - `GET /api/billing/wallet`: current balance, usage summary, and recent ledger entries.
  - `POST /api/billing/wallet/top-up`: create checkout/top-up session (e.g. Stripe Checkout / PaymentIntent) and credit the wallet idempotently on webhook confirmation.
  - Emit a low-balance notification via the `notification` BullMQ queue (`category: "billing"`) when balance drops below `lowBalanceThreshold`.
- [ ] **Dashboard UI (`apps/web/src/app/dashboard/`)**:
  - Display live token/credit balance badge and "Top Up Credits" action in `/dashboard/ai` and `/dashboard/settings/billing`.
  - Show per-model token spend history and top-up receipts.

---

## 2. AI Runtime & Scalability Enhancements

- [ ] **Per-Request Model Selection & Tenant BYOK**:
  - Allow selecting a model per conversation in `/dashboard/ai` (validated against `AI_PROVIDERS`) or storing encrypted organization-level provider API keys in PostgreSQL, resolved dynamically via Mastra `RequestContext`.
- [ ] **Background BullMQ Workflow Execution (`apps/worker`)**:
  - Add an `ai-workflow` queue in `apps/api/src/lib/queues.ts` and `apps/worker` for long-running multi-step Mastra workflows (`run.startAsync()`), with completion notifications delivered over the existing notification pipeline.
- [ ] **Tenant-Scoped RAG / Document Knowledge Base (`packages/ai-core`)**:
  - Index committed text/markdown/PDF files from `apps/api/src/modules/storage` into `PgVector` (`mastra` schema) with mandatory `{ organizationId }` metadata filters and a `query-workspace-knowledge` agent tool.
- [ ] **Connection Pool Consolidation**:
  - Add PgBouncer (or shared `pg.Pool` configuration) when scaling `apps/api` horizontally so Drizzle (`@workspace/db`) and Mastra (`@mastra/pg`) share bounded PostgreSQL connections.
