# Code Conventions

- **Package Isolation**: `bunfig.toml` enforces `linker = "isolated"`; declare every package dependency explicitly in its workspace `package.json`.
- **File Naming**: Kebab-case filenames across all directories (`auth-client.ts`, `auth-provider.tsx`).
- **Component Naming**: PascalCase for React component definitions (`AuthModalProvider`, `SignIn`).
- **Hook Naming**: Prefixed with `use` (`useSession`, `useCurrentOrganization`).
- **Imports**: Biome sorts imports automatically (`bun run fix`). Use explicit workspace specifiers (`@workspace/ai-core`, `@workspace/ai-core/contracts`, `@workspace/api/*`, `@workspace/db`, `@workspace/ui`) and `@/*` inside `apps/web`. Never import `@workspace/api` from `packages/ai-core` (keeps the workspace DAG acyclic).
- **Typing & Safety**:
  - Strict TypeScript with `noUncheckedIndexedAccess` and no `any` — use `unknown` with runtime narrowing or Zod schemas.
  - Validate environment variables via Zod schemas (`apps/api/src/env.ts`, `apps/worker/src/env.ts`, `apps/web/src/env.ts`) and keep secrets (including AI provider keys such as `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) out of `NEXT_PUBLIC_*`.
  - Infer database types from Drizzle tables using `typeof table.$inferSelect`, and keep Drizzle migrations scoped with `schemaFilter: ["public"]` so Mastra's `mastra` schema remains isolated.
