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
