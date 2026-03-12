# Testing Patterns

**Analysis Date:** 2026-03-12

## Test Framework

**Runner:**
- Vitest ^4.0.0 (from catalog)
- Config: `vitest.config.ts` at repo root
- Browser tests: `vitest.browser.config.ts` (Playwright-based)

**Assertion Library:**
- `node:assert/strict` for Effect tests
- `vitest` built-in: `expect()` for standard tests
- Both used depending on test context

**Run Commands:**
```bash
bun run test                # Run all unit tests via turbo
bun run test:browser        # Run browser-specific tests (web app)
bun run test:browser:install # Install Playwright chromium for browser tests
```

**Test Scripts by Package:**
- Root: `turbo run test` - Runs all package tests in parallel
- Web: `vitest run --passWithNoTests` - Allows passing when no tests exist
- Desktop: `vitest run` - Standard test run
- Shared: `vitest run` - Standard test run
- Server: Tests use `@effect/vitest` adapter
- Contracts: Tests use `@effect/vitest` adapter

## Test File Organization

**Location:**
- Co-located with source files (not in separate `__tests__` directory)
- Same directory as implementation

**Naming:**
- `*.test.ts` for TypeScript utility/logic tests
- `*.test.tsx` for React component tests
- `*.spec.ts` / `*.spec.tsx` not used (use `.test` suffix exclusively)
- Browser-specific: `*.browser.tsx` files (e.g. `ChatView.browser.tsx`)

**Structure:**
```
apps/web/src/
├── components/
│   ├── ChatMarkdown.tsx
│   ├── ChatMarkdown.test.tsx     # (if exists)
│   ├── Sidebar.logic.test.ts     # Logic extracted from component
│   ├── toast.logic.test.ts       # Toast logic unit tests
│   └── ...
├── lib/
│   ├── utils.ts
│   └── utils.test.ts             # Co-located test
└── main.tsx

packages/shared/src/
├── git.ts
├── git.test.ts                   # Co-located test
├── model.ts
├── model.test.ts                 # Co-located test
└── ...

packages/contracts/src/
├── orchestration.ts
├── orchestration.test.ts         # Effect-based test
└── ...
```

## Test Structure

**Suite Organization - Standard Vitest:**

```typescript
import { describe, expect, it } from "vitest";

describe("functionName", () => {
  it("does something specific", () => {
    const result = myFunction(input);
    expect(result).toBe(expectedValue);
  });

  it("handles edge case", () => {
    const result = myFunction(edgeInput);
    expect(result).toBeNull();
  });
});
```

**Suite Organization - Effect/Vitest:**

```typescript
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

const decodeSchema = Schema.decodeUnknownEffect(MySchema);

it.effect("parses valid input", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSchema(validInput);
    assert.strictEqual(parsed.field, expectedValue);
  }),
);

it.effect("rejects invalid input", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeSchema(invalidInput));
    assert.strictEqual(result._tag, "Failure");
  }),
);
```

**Patterns:**
- Setup per describe block: None (prefer factories or maker functions)
- Teardown: None standard (Effect handles resource cleanup)
- Assertion pattern: `expect()` for standard, `assert` for Effect
- Test data: Use factories (e.g. `makeLatestTurn()`, `makeSession()`) instead of `beforeEach`

**Maker Functions (Test Data):**

```typescript
function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): ThreadStatusInput["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: "completedAt" in (overrides ?? {})
      ? (overrides!.startedAt ?? "2026-03-09T10:00:00.000Z")
      : "2026-03-09T10:00:00.000Z",
    completedAt: "completedAt" in (overrides ?? {})
      ? (overrides!.completedAt ?? null)
      : "2026-03-09T10:05:00.000Z",
  };
}

const baseThread: ThreadStatusInput = {
  interactionMode: "default",
  latestTurn: null,
  lastVisitedAt: undefined,
  proposedPlans: [],
  session: null,
};

// Usage in test
it("returns false when there is no latest turn", () => {
  expect(hasUnseenCompletion(baseThread)).toBe(false);
});

it("returns true when completed after last visit", () => {
  expect(
    hasUnseenCompletion({
      ...baseThread,
      latestTurn: makeLatestTurn(),
      lastVisitedAt: "2026-03-09T10:04:00.000Z",
    }),
  ).toBe(true);
});
```

## Mocking

**Framework:**
- `vitest` built-in `vi.fn()`, `vi.mock()` for unit tests
- No explicit mocking library needed

**Patterns:**

```typescript
// Mock hoisting for module mocks
const { showMessageBoxMock } = vi.hoisted(() => ({
  showMessageBoxMock: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: showMessageBoxMock,
  },
}));

// Usage in test
it("returns false for empty messages", async () => {
  const result = await showDesktopConfirmDialog("   ", null);

  expect(result).toBe(false);
  expect(showMessageBoxMock).not.toHaveBeenCalled();
});

it("opens a dialog and returns true on confirm", async () => {
  showMessageBoxMock.mockResolvedValue({ response: 1 });

  const result = await showDesktopConfirmDialog("Delete?", ownerWindow);

  expect(result).toBe(true);
  expect(showMessageBoxMock).toHaveBeenCalledWith(
    ownerWindow,
    expect.objectContaining({
      buttons: ["No", "Yes"],
      message: "Delete?",
    }),
  );
});
```

**Mock Reset Pattern:**

```typescript
beforeEach(() => {
  showMessageBoxMock.mockReset();
});
```

**What to Mock:**
- External dependencies: file system, network, child processes, Electron APIs
- Third-party libraries when integration isn't being tested
- Other modules only when testing in isolation is critical

**What NOT to Mock:**
- Pure utility functions (test the real implementation)
- Type constructors/schemas (test validation thoroughly)
- Error handling paths (mock the condition but not the handler)

## Fixtures and Factories

**Test Data:**

```typescript
// Inline factory in test file
function makeLatestTurn(overrides?: Partial<TurnData>): TurnData {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    // ... defaults
    ...overrides,
  };
}

// Usage
it("test", () => {
  const turn = makeLatestTurn({ state: "pending" });
  expect(turn.state).toBe("pending");
});
```

**Location:**
- Small factories: Within test file at top level
- Shared fixtures: Not extracted (keep tests self-contained per AGENTS.md maintainability)
- Complex data: Create maker functions as needed per test

**Patterns:**
- Use spread operator for overrides: `{ ...baseObject, ...overrides }`
- Maker functions are pure, no side effects
- No globals or shared state

## Coverage

**Requirements:** Not enforced (no coverage threshold set)

**View Coverage:**
```bash
# Coverage not configured in vitest.config.ts
# To add coverage, configure with @vitest/coverage-* provider
```

**Current State:** Coverage collection not enabled

**Recommendation:** Add coverage configuration if/when quality metrics needed

## Test Types

**Unit Tests:**
- Scope: Single function/module in isolation
- Approach: Direct function calls, mocked dependencies
- Location: Co-located `*.test.ts` files
- Examples: `git.test.ts`, `model.test.ts`, `pendingUserInput.test.ts`
- Speed: <1ms per test typical

**Integration Tests:**
- Scope: Multiple functions working together
- Approach: Combine related modules, test data flow
- Location: Same `*.test.ts` files, integrated test suites
- Examples: Schema validation + effect handling in `orchestration.test.ts`
- Speed: <10ms per test typical

**Browser Tests (Web App Only):**
- Scope: Component rendering and interaction in real browser
- Framework: Vitest + Playwright
- Location: `*.browser.tsx` files
- Config: `vitest.browser.config.ts`
- Instance: Chromium only (`instances: [{ browser: "chromium" }]`)
- Headless: true
- Timeout: 30s for test + hook
- Included files: `src/components/ChatView.browser.tsx`
- Speed: 5-30s per test (browser overhead)

**E2E Tests:**
- Framework: Not used (integration tests sufficient)
- Type: Desktop app has smoke tests via `bun test:desktop-smoke`

## Common Patterns

**Async Testing - Standard:**

```typescript
it("handles async operation", async () => {
  const result = await asyncFunction();
  expect(result).toBe(expectedValue);
});
```

**Async Testing - Effect:**

```typescript
it.effect("handles async effect", () =>
  Effect.gen(function* () {
    const result = yield* effectFunction();
    assert.strictEqual(result, expectedValue);
  }),
);
```

**Error Testing - Expected Return:**

```typescript
it("returns null for invalid input", () => {
  const result = parseValue("invalid");
  expect(result).toBeNull();
});
```

**Error Testing - Effect Exit:**

```typescript
it.effect("rejects invalid schema", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      Schema.decodeUnknownEffect(Schema)(invalidData),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
```

**Array/Object Testing:**

```typescript
it("builds correct answer map", () => {
  expect(buildAnswers(questions, answers)).toEqual({
    scope: "Orchestration-first",
    compat: "Keep envelope for one release",
  });
});

it("returns null when incomplete", () => {
  expect(buildAnswers(questions, {})).toBeNull();
});
```

**Mock Call Assertions:**

```typescript
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
expect(mockFn).not.toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith(
  expectedArg,
  expect.objectContaining({ expectedField: value }),
);
```

**Conditional Type Narrowing in Tests:**

```typescript
// Verify discriminated union
if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
  assert.strictEqual(parsed.body.threadId, "thread-1");
}
```

## Test Examples by Type

**Simple Pure Function:**

```typescript
// git.test.ts
describe("extractHostFromRemoteUrl", () => {
  it("extracts host from SSH format", () => {
    expect(extractHostFromRemoteUrl("git@github.com:org/repo.git")).toBe(
      "github.com",
    );
  });

  it("returns null for empty string", () => {
    expect(extractHostFromRemoteUrl("")).toBeNull();
  });
});
```

**State Reduction Function:**

```typescript
// updateMachine.test.ts
describe("updateMachine", () => {
  it("clears transient errors when a check starts", () => {
    const state = reduceDesktopUpdateStateOnCheckStart(
      {
        ...createInitialDesktopUpdateState("1.0.0"),
        enabled: true,
        status: "error",
        message: "network",
        errorContext: "check",
        canRetry: true,
      },
      "2026-03-04T00:00:00.000Z",
    );

    expect(state.status).toBe("checking");
    expect(state.message).toBeNull();
    expect(state.errorContext).toBeNull();
    expect(state.canRetry).toBe(false);
  });
});
```

**Complex Logic with Makers:**

```typescript
// Sidebar.logic.test.ts
describe("resolveThreadStatusPill", () => {
  const baseThread: ThreadStatusInput = {
    interactionMode: "default",
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: null,
  };

  it("shows Pending Approval with highest priority", () => {
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: makeSession({ status: "running" }) },
      hasPendingApprovals: true,
      hasPendingUserInput: true,
    });
    expect(result?.label).toBe("Pending Approval");
    expect(result?.pulse).toBe(false);
  });
});
```

**Effect + Schema Validation:**

```typescript
// ws.test.ts
const decodeWebSocketRequest = Schema.decodeUnknownEffect(WebSocketRequest);

it.effect("accepts getTurnDiff requests when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-1",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: "thread-1",
        fromTurnCount: 1,
        toTurnCount: 2,
      },
    });
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
  }),
);
```

**Mocking External Dependency:**

```typescript
// confirmDialog.test.ts
const { showMessageBoxMock } = vi.hoisted(() => ({
  showMessageBoxMock: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: showMessageBoxMock,
  },
}));

describe("showDesktopConfirmDialog", () => {
  beforeEach(() => {
    showMessageBoxMock.mockReset();
  });

  it("returns false and does not open a dialog for empty messages", async () => {
    const result = await showDesktopConfirmDialog("   ", null);

    expect(result).toBe(false);
    expect(showMessageBoxMock).not.toHaveBeenCalled();
  });
});
```

## Important Rules (from AGENTS.md)

- **Always run tests via `bun run test`** - Never use bare `bun test` (it won't work correctly)
- Use vitest, not Jest, for all tests
- Co-locate tests with source files (don't use `__tests__` directories)
- Tests must pass before considering tasks complete
- Combined with `bun lint` and `bun typecheck` for full validation

---

*Testing analysis: 2026-03-12*
