# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome provides robust linting and formatting. Most issues are automatically fixable with `bun run fix`.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness
- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers

### Modern JavaScript/TypeScript
- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use `const` by default, `let` only when reassignment is needed, never `var`

### React & Next.js
- Next.js App Router: Keep Server and Client boundaries clear. Use Server Components for async data fetching and Client Components (`"use client"`) for hooks/state.
- React 19: Pass `ref` directly as a prop instead of using `forwardRef`.
- Hook rules: Call hooks unconditionally at the top level with exhaustive dependencies.
- Accessibility: Semantic HTML (`<button>`, `<dialog>`), explicit labels, keyboard navigation, and ARIA attributes.

### Error Handling
- Never silence errors silently. Catch, log with context, and rethrow or return typed error responses.
- Prefer early returns to keep nesting flat.

### Testing & Verification
- Verify your changes with `bun run check` and `bun run check-types` before completing tasks.
