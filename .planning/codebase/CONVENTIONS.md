# Coding Conventions

**Analysis Date:** 2026-03-12

## Naming Patterns

**Files:**
- React components: PascalCase, descriptive names, e.g. `ChatMarkdown.tsx`, `GitActionsControl.tsx`
- Utility/helper files: camelCase or descriptive, e.g. `pendingUserInput.ts`, `git.ts`
- Logic files: suffix `.logic` for extracted logic from components, e.g. `Sidebar.logic.test.ts`, `toast.logic.test.ts`
- Test files: `*.test.ts` or `*.test.tsx` suffix for co-located tests, e.g. `git.test.ts`, `pendingUserInput.test.ts`
- Browser-specific: `.browser` suffix for browser tests, e.g. `ChatView.browser.tsx`
- Desktop-specific: no suffix, just module name, e.g. `updateMachine.ts`, `confirmDialog.ts`

**Functions:**
- camelCase: `extractHostFromRemoteUrl`, `detectForgeProviderFromRemoteUrl`, `buildPendingUserInputAnswers`
- Prefix verbs clearly: `resolve*`, `extract*`, `detect*`, `sanitize*`, `derive*`, `build*`, `create*`, `reduce*`
- Boolean functions: `has*`, `is*`, `should*`, `can*`, e.g. `hasUnseenCompletion`, `shouldClearThreadSelectionOnMouseDown`
- Getter functions: `get*`, e.g. `getDefaultModel`, `getModelOptions`

**Variables:**
- camelCase for all variables: `session`, `threadId`, `completedAt`, `selectedOptionLabel`
- Constants (module-level): UPPER_SNAKE_CASE, e.g. `MAX_HIGHLIGHT_CACHE_ENTRIES`, `PATH_CAPTURE_START`
- Branded type instances: camelCase, e.g. `requestId`, `threadId`, `turnId`
- Store objects/modules: camelCase, e.g. `pendingApprovals`, `pendingUserInputs`

**Types:**
- PascalCase: `ThreadStatusInput`, `ChatMarkdownProps`, `ProviderSession`, `ForgeProvider`
- Generic/utility types: descriptive names in PascalCase, e.g. `ExecFileSyncLike`, `CodexSessionContext`
- Union type variants: use `_tag` discriminator fields as lowercase, e.g. `_tag: "Failure"`

## Code Style

**Formatting:**
- Tool: `oxfmt` - Rust-based formatter
- Indentation: Implicit (oxfmt handles this)
- Semicolons: Required at statement end
- Max line length: Not explicitly enforced but readability preferred
- Config: `.oxfmtrc.json` at root

**Linting:**
- Tool: `oxlint` - Rust-based linter
- Plugins: eslint, oxc, react, unicorn, typescript
- Categories configured:
  - `correctness: warn`
  - `suspicious: warn`
  - `perf: warn`
- Disabled rules:
  - `react-in-jsx-scope: off` (React 18+, JSX pragma not needed)
  - `eslint/no-shadow: off` (Allowed deliberately)
  - `eslint/no-await-in-loop: off` (Allowed deliberately)
- Ignore patterns: `dist`, `dist-electron`, `node_modules`, `*.tsbuildinfo`, `**/routeTree.gen.ts`, `.plans`
- Run: `bun lint` (via oxlint at repo root)

**TypeScript Strictness:**
- `target: ES2023`
- `module: ESNext`
- `strict: true` - All strict type checks enabled
- `noUncheckedIndexedAccess: true` - Must check array/object index access
- `exactOptionalPropertyTypes: true` - Disallow `undefined` in optional property shorthand
- `noImplicitOverride: true` - Must annotate method overrides with `override` keyword
- `useDefineForClassFields: true` - Use define-based field initialization
- Config: `tsconfig.base.json` at root

## Import Organization

**Order:**
1. Node built-ins (e.g. `import { spawn } from "node:child_process"`)
2. Third-party libraries (e.g. `import { Effect, Schema } from "effect"`, `import React from "react"`)
3. Local type/contract imports (e.g. `import { ThreadId, ProviderSession } from "@xbetools/contracts"`)
4. Local utility imports (e.g. `import { normalizeModelSlug } from "@xbetools/shared/model"`)
5. Relative imports for same app/package

**Path Aliases:**
- `~` - Web app src directory alias in `vitest.browser.config.ts`
- Workspace imports: `@xbetools/*` - Use subpath exports, NOT barrel files
  - Correct: `import { git } from "@xbetools/shared/git"`
  - Not: `import { git } from "@xbetools/shared"`
- `@xbetools/contracts` - Main contract package
- `@xbetools/shared` - Shared runtime utilities (git, model, logging, shell, Net)
- `@xbetools/web` - Web app (not imported externally, internal only)
- `@xbetools/server` - Server (not imported externally, internal only)
- `@xbetools/desktop` - Desktop app (not imported externally, internal only)

**Explicit Subpath Exports (per AGENTS.md):**
- `@xbetools/shared` uses explicit subpath exports - no barrel index
  - `./model` - Model utilities
  - `./git` - Git utilities
  - `./logging` - Logging utilities
  - `./shell` - Shell utilities
  - `./Net` - Network utilities

## Error Handling

**Patterns:**
- Effect-based error handling: Use `Effect.try*` or `Effect.exit` for error wrapping
- Schema validation: Use `Schema.decodeUnknownEffect` for input validation, catch with `Effect.exit`
- Null returns: Functions return `null` for expected failures (e.g. `extractHostFromRemoteUrl`)
- Exceptions: Thrown only for exceptional/unexpected conditions
- Error metadata: Include context in error messages for debugging
- Check pattern: Assert with conditions before operations (e.g. `if (startIndex === -1) return null`)

**Examples:**
```typescript
// Validation with null return for expected failure
export function extractHostFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  // ... logic
  return host.length > 0 ? host : null;
}

// Effect-based error handling
const result = yield* Effect.exit(
  decodeWebSocketRequest({
    id: "req-1",
    body: { /* ... */ },
  }),
);
assert.strictEqual(result._tag, "Failure");

// Try-catch with logging
try {
  const parsed = new URL(trimmed);
  // ... logic
} catch {
  return null;  // Expected parsing failure
}
```

## Logging

**Framework:** `console` (direct) - No logging library required

**Patterns:**
- Use `console.log` for informational messages
- Use `console.warn` for warnings
- Use `console.error` for errors
- Format: Include operation name and data, e.g. `console.log("codex model/list response", modelListResponse)`
- Desktop: Use `RotatingFileSink` from `@xbetools/shared/logging` for file-based logging
- No structured logging library used (keeps it lightweight)

**Location examples:**
- `apps/server/src/logger.ts` - Server logging utility
- `apps/desktop/src/rotatingFileSink.test.ts` - Desktop file sink tests

## Comments

**When to Comment:**
- JSDoc for public API functions (especially in contract/utility modules)
- Algorithm explanation for complex logic
- TODO/FIXME only when leaving known issues for next person
- Avoid comments for obvious code; prefer clear naming

**JSDoc/TSDoc:**
- Use for exported functions in public modules
- Include parameter descriptions and return type hints
- Example from `git.ts`:
```typescript
/**
 * Extract the hostname from a git remote URL.
 * Handles SSH (`git@host:group/repo.git`) and HTTPS (`https://host/group/repo.git`) formats.
 */
export function extractHostFromRemoteUrl(url: string): string | null {
  // ...
}
```

**Comments for Edge Cases:**
- Explain non-obvious behavior or workarounds
- Include reproduction steps for known limitations
- Example from codebase: Trimming branded IDs at decode boundaries explained

## Function Design

**Size:** Keep functions focused and testable
- Aim for <50 lines for most functions
- Longer functions (100+ lines) should be refactored
- Each function should have a clear single purpose

**Parameters:**
- Max 3-4 parameters; use objects for more
- Use destructuring for related parameters
- Example: `ThreadStatusInput` object instead of multiple scalar params
- Optional params: Use object with optional properties, not overloading

**Return Values:**
- Explicit return types required (TypeScript strict mode)
- Use `| null` for expected failures, `throw` for exceptional errors
- Consistent pattern: functions return matching types across module
- Example: All git utilities return `string | null` for parsing failures

**Pure Functions Preferred:**
- Avoid side effects when possible
- Use Effect for controlled side effects (server/system operations)
- Keep logic functions pure (suffix `.logic` for extracted pure logic)

## Module Design

**Exports:**
- Named exports preferred: `export function foo() {}`
- Default exports only for React components or specific patterns
- Barrel files: NOT used in `@xbetools/shared`, explicitly banned
- Each utility module exports specific functions/types

**Barrel Files:**
- Not used in `@xbetools/shared` per design
- Web app may use selective re-exports but discouraged
- Server modules use relative imports

**File Organization:**
- One public function/export per file when possible
- Group related functions in same file if tightly coupled
- Separate concerns: business logic, UI, testing utilities
- Example: `Sidebar.logic.test.ts` separates logic from component

**Package Structure:**
- `apps/server`, `apps/web`, `apps/desktop` - Separate concerns
- `packages/contracts` - Schema-only, no runtime logic
- `packages/shared` - Shared runtime utilities with subpath exports

## Error Boundaries

**React:**
- Use `ErrorBoundary` class components for catching render errors
- Example: `CodeHighlightErrorBoundary` in `ChatMarkdown.tsx`
- Fallback UI required when catching errors
- Log errors for debugging

## Type Imports

**Pattern:**
- Use `type` keyword for type-only imports to enable tree-shaking
- Example: `import type { BrowserWindow } from "electron"`
- Keep type and value imports separate for clarity
- Branded types: imported normally (have runtime representation)

---

*Convention analysis: 2026-03-12*
