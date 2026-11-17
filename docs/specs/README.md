# Architecture & Feature Specs (`docs/specs/`)

Optional directory for short design specs (`YYYY-MM-DD-<feature>-design.md`) before **major, multi-file, or radical changes** (skip for routine features, UI tweaks, and bug fixes). If implementation diverges from a locked spec, record the pivot in [../DECISIONS.md](../DECISIONS.md).

```markdown
# <Feature Name> — Design Spec

**Status:** DRAFT | LOCKED · **Date:** YYYY-MM-DD

## Intent & Why
What problem this solves and why now.

## Goals & Non-Goals
- **Goals:** ...
- **Non-Goals:** ...

## Approaches Considered
1. **Approach A *(Selected)*** — ...
2. **Approach B** — Rejected because...

## Architecture & Files to Touch
- `apps/api/...`
- `packages/...`
- `apps/web/...`

## Verification
- `bun run check`, `bun run check-types`, `bun run test`, and any feature-specific evals.
```
