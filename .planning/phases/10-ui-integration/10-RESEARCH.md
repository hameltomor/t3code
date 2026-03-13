# Phase 10: UI Integration - Research

**Researched:** 2026-03-13
**Domain:** React UI -- context status display in composer footer, zustand store mapping, debounce/hysteresis, feature flags
**Confidence:** HIGH

## Summary

Phase 10 connects the server-side context status pipeline (completed in Phase 9) to the user-visible UI. The data already arrives on every `OrchestrationThread` in the snapshot (`contextStatus: OrchestrationThreadContextStatus | null`), but the web app currently does NOT map this field through to its local `Thread` type or zustand store. The primary work is: (1) bridge the store mapping gap, (2) build a pure-logic derivation layer for threshold coloring, freshness, and compaction states, (3) create a `ContextStatusIndicator` component that renders in the composer footer, and (4) add comprehensive rendering tests.

The existing codebase follows a strong pattern of separating pure logic (`.logic.ts` or standalone `.ts` modules) from React components (`.tsx`), with vitest unit tests for the logic and separate browser tests for full-app integration. Phase 10 should follow this exact pattern: a `contextStatus.logic.ts` file with pure derivation functions and a `ContextStatusIndicator.tsx` component. All threshold coloring, freshness checks, and compaction recency are computed in the logic layer and tested with standard vitest unit tests.

**Primary recommendation:** Add `contextStatus` to the web `Thread` type, map it in `syncServerReadModel`, create a pure logic module for all UI derivations, build the component using existing Badge/Tooltip primitives, and apply debounce via `@tanstack/react-pacer`'s `Debouncer` (already in use for localStorage persistence with the same 500ms wait).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | ^5.0.11 | State store for threads/projects | Already used for all app state; `useStore` and granular selectors established |
| @tanstack/react-pacer | ^0.19.4 | Debounce/throttle primitives | Already used for state persistence debouncing and domain event throttling |
| @base-ui/react | ^1.2.0 | Tooltip primitive | Already used for all tooltips in the app |
| class-variance-authority | ^0.7.1 | Badge variant styling | Already used for Badge component |
| vitest | (catalog) | Unit and browser testing | Already used for all tests in the web app |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @xbetools/contracts | workspace:* | `OrchestrationThreadContextStatus` type | Import for type-safe context status field |
| tailwind-merge | ^3.4.0 | Class name merging | Used via `cn()` utility for conditional styling |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand store mapping | Separate zustand store for context status | Extra store adds complexity; the data is already per-thread and fits naturally on the Thread type |
| @tanstack/react-pacer Debouncer | Custom setTimeout debounce | Debouncer is already imported and proven in the codebase; custom solution risks edge cases (cleanup, flush on unmount) |
| Vite env var for feature flag | AppSettings schema extension | Vite env var is simpler for build-time internal-only flag; AppSettings is for user-configurable settings |

**Installation:** No new packages needed. All dependencies are already in `apps/web/package.json`.

## Architecture Patterns

### Recommended Project Structure

```
apps/web/src/
  components/
    ContextStatusIndicator.tsx           # React component (minimal badge + full pill modes)
    contextStatusIndicator.logic.ts      # Pure derivation functions (threshold, freshness, compaction)
    contextStatusIndicator.logic.test.ts # Unit tests for all logic
  types.ts                               # Extended Thread type with contextStatus field
  store.ts                               # Extended syncServerReadModel to map contextStatus
```

### Pattern 1: Pure Logic Separation (Established Pattern)

**What:** All derivation/computation lives in `.logic.ts` files, not in React components.
**When to use:** Any non-trivial state derivation that can be unit tested without React rendering.
**Example (from codebase):**
```typescript
// Source: apps/web/src/session-logic.ts -- existing pattern
export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
```

Applied to context status:
```typescript
// contextStatusIndicator.logic.ts
export type ContextThreshold = "neutral" | "watch" | "warning" | "danger";

export function deriveContextThreshold(percent: number | undefined): ContextThreshold {
  if (percent === undefined) return "neutral";
  if (percent >= 95) return "danger";
  if (percent >= 85) return "warning";
  if (percent >= 70) return "watch";
  return "neutral";
}
```

### Pattern 2: Zustand Store Field Mapping (Established Pattern)

**What:** `syncServerReadModel` maps `OrchestrationReadModel` fields to the local `Thread` type.
**When to use:** When new fields arrive from the server read model.
**Example (from codebase):**
```typescript
// Source: apps/web/src/store.ts lines 228-302 -- existing pattern
// Each OrchestrationThread field is explicitly mapped to Thread
return {
  id: thread.id,
  // ... existing fields ...
  activities: thread.activities.map((activity) => ({ ...activity })),
  // NEW: contextStatus passthrough
};
```

### Pattern 3: Granular Selector Hooks (Established Pattern)

**What:** Custom selector hooks prevent unnecessary re-renders.
**When to use:** When a component only needs a subset of a thread's data.
**Example (from codebase):**
```typescript
// Source: apps/web/src/store.ts lines 486-494
export function useThread(threadId: ThreadId | null | undefined): Thread | undefined {
  return useStore(
    useCallback(
      (store: AppStore) =>
        threadId ? store.threads.find((t) => t.id === threadId) : undefined,
      [threadId],
    ),
  );
}
```

### Pattern 4: Debouncer for Visual Stability (Established Pattern)

**What:** `Debouncer` from `@tanstack/react-pacer` prevents visual flicker.
**When to use:** When rapid state updates would cause distracting UI changes.
**Example (from codebase):**
```typescript
// Source: apps/web/src/store.ts lines 102, 470
const debouncedPersistState = new Debouncer(persistState, { wait: 500 });
useStore.subscribe((state) => debouncedPersistState.maybeExecute(state));
```

### Pattern 5: Feature Flag via Vite Env Variable

**What:** Use `import.meta.env.VITE_*` for build-time feature flags.
**When to use:** Internal-only features that should not ship to users by default.
**Rationale:** The codebase already uses `VITE_WS_URL` for dev-time configuration. No feature flag system exists; a Vite env var is the simplest option for a build-time internal-only flag. The requirement (UI-03) explicitly states "not user-configurable until settings UI exists", which matches a build-time env var perfectly.
```typescript
// Usage pattern:
const FULL_PILL_MODE = import.meta.env.VITE_CONTEXT_STATUS_FULL_PILL === "true";
```

### Anti-Patterns to Avoid

- **Provider-specific UI branches:** All rendering uses normalized `OrchestrationThreadContextStatus` data. The component MUST NOT have `if (provider === "codex")` conditionals. Out of scope per REQUIREMENTS.md.
- **Client-side token counting:** The UI is a read-only observer. Never compute token counts on the client.
- **Inline threshold logic in JSX:** All derivation must live in the `.logic.ts` file, not scattered across the component.
- **Subscribing to the full thread object:** Use a targeted selector for just `contextStatus` and `session` to avoid re-renders on every message update.
- **Stale state flash:** On initial render before the first snapshot sync, `contextStatus` is null. The component must NOT briefly show "Context unknown" and then switch to a percentage. The UI-08 requirement handles this: badge is not rendered when no session exists.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounce rendering | Custom setTimeout debounce | `@tanstack/react-pacer` `Debouncer` | Already proven in the codebase; handles cleanup, flush, and cancellation |
| Tooltip | Custom tooltip div | `@base-ui/react` Tooltip primitives | Already wrapped in `apps/web/src/components/ui/tooltip.tsx`; handles positioning, portaling, animation |
| Badge styling | Custom colored span | Existing `Badge` component with CVA variants | Already handles responsive sizing, variant colors, accessibility |
| Threshold coloring | Inline ternary chains in JSX | Pure function mapping threshold to Badge variant | Testable, predictable, no visual logic in component |
| Relative time formatting | Custom date math | Existing `formatDuration` / `formatTimestamp` from `session-logic.ts` | Already handles edge cases (NaN, negative, zero) |

**Key insight:** The codebase has strong UI primitives (Badge, Tooltip, Separator) and established utility functions. Phase 10 should compose these, not create parallel implementations.

## Common Pitfalls

### Pitfall 1: Rendering Badge When No Session Exists

**What goes wrong:** The context status badge appears briefly for threads without active sessions, showing "Context unknown" when the user hasn't even started a session.
**Why it happens:** `contextStatus` can be non-null even when session is stopped (it persists from the last active session via the projection table).
**How to avoid:** The component must check BOTH `contextStatus !== null` AND `session !== null && session.status is not "closed"/"disconnected"` before rendering. UI-08 is explicit: "Context status badge is not rendered when session is stopped or no session exists."
**Warning signs:** Badge appears on the sidebar or in threads that haven't been used recently.

### Pitfall 2: Threshold Mismatch Between Server and UI

**What goes wrong:** The server computes `status: "ok"` at 74%, but the UI requirement says watch starts at 70%. The component uses the server `status` field directly and shows the wrong color.
**Why it happens:** The server `status` field uses different thresholds (ok < 75%, watch >= 75%, near-limit >= 95%) than the UI requirement (neutral < 70%, watch 70-85%, warning 85-95%, danger >= 95%).
**How to avoid:** The UI must derive threshold coloring from the `percent` value, NOT from the `status` string. The `status` field is for server-side logic and monitoring; the UI has its own threshold bands for display purposes.
**Warning signs:** Colors don't match the requirements table.

### Pitfall 3: Flicker on Rapid Token Events

**What goes wrong:** The context percentage jumps rapidly (e.g., 42% -> 43% -> 44% -> 45%) during streaming, causing the badge to rapidly re-render with visible flicker.
**Why it happens:** The server throttles at 2 seconds, and the web client re-fetches snapshots on domain events throttled at 100ms. But the zustand store update triggers immediate re-renders.
**How to avoid:** Apply a 500ms debounce on the context status value consumed by the component. This is the hysteresis requirement (UI-07). Use a `useDebouncedValue` hook or `Debouncer` instance. The debounce should apply to the derived display state, not the raw store value, so that the store always has fresh data for other consumers.
**Warning signs:** The percentage number visibly jumps during long turns.

### Pitfall 4: "Context unknown" Shown When Percentage Exists

**What goes wrong:** The UI shows "Context unknown" even when there's a valid percentage, because the component checks `status === "unknown"` instead of checking `percent`.
**Why it happens:** The `status` field can be "unknown" even when `percent` is defined (edge case with very new data). Or `status` is "compacted" but `percent` is available.
**How to avoid:** Always check `percent !== undefined` for deciding between "Context XX%" and "Context unknown". The `status` field influences coloring only when the UI-layer thresholds don't apply.
**Warning signs:** "Context unknown" appears when other providers (like Codex) that always have context limits are in use.

### Pitfall 5: Full Pill Mode Leaking to Production

**What goes wrong:** The full pill + tooltip mode ships to all users instead of being internal-only.
**Why it happens:** The feature flag defaults to `true` or the condition is inverted.
**How to avoid:** Use a Vite env variable (`VITE_CONTEXT_STATUS_FULL_PILL`) that defaults to `undefined`/`"false"`. The component should explicitly check `=== "true"`. Build without the env var set = minimal badge only.
**Warning signs:** Non-developer users see detailed token counts and source labels.

### Pitfall 6: Missing contextStatus in Types and Store Mapping

**What goes wrong:** TypeScript errors or `contextStatus` silently being `undefined` on the web Thread type.
**Why it happens:** The `Thread` interface in `types.ts` doesn't include `contextStatus`, and `syncServerReadModel` in `store.ts` doesn't map it from the read model.
**How to avoid:** This is the FIRST task: add the field to `Thread`, update `syncServerReadModel` to pass it through, update `store.test.ts` factory to include it, and update `ChatView.browser.tsx` factory to include it.
**Warning signs:** Property access errors, or the component always sees `null`.

## Code Examples

Verified patterns from the existing codebase:

### Store Mapping Extension

```typescript
// Source: apps/web/src/types.ts -- extend Thread interface
import type { OrchestrationThreadContextStatus } from "@xbetools/contracts";

export interface Thread {
  // ... existing fields ...
  contextStatus: OrchestrationThreadContextStatus | null;
}
```

```typescript
// Source: apps/web/src/store.ts -- extend syncServerReadModel mapping
// Inside the .map((thread) => { ... }) block:
return {
  // ... existing fields ...
  contextStatus: thread.contextStatus ?? null,
};
```

### Pure Threshold Derivation

```typescript
// contextStatusIndicator.logic.ts

export type ContextThreshold = "neutral" | "watch" | "warning" | "danger";

export interface ContextStatusDisplay {
  /** Human-readable label: "Context 42%" or "Context unknown" */
  label: string;
  /** Threshold for coloring */
  threshold: ContextThreshold;
  /** Whether to show the badge at all */
  visible: boolean;
  /** "Compacted recently" flag */
  compactedRecently: boolean;
  /** Freshness is stale -- show last updated time */
  isStale: boolean;
  /** Formatted time since last measurement for stale display */
  lastUpdatedLabel: string | null;
}

export function deriveContextStatusDisplay(
  contextStatus: OrchestrationThreadContextStatus | null,
  sessionActive: boolean,
  nowMs: number,
): ContextStatusDisplay {
  // UI-08: not rendered when no session
  if (!sessionActive || !contextStatus) {
    return { label: "", threshold: "neutral", visible: false, compactedRecently: false, isStale: false, lastUpdatedLabel: null };
  }

  const percent = contextStatus.percent;
  const threshold = deriveContextThreshold(percent);

  // UI-04: "Context unknown" when no percentage
  const label = percent !== undefined
    ? `Context ${Math.round(percent)}%`
    : "Context unknown";

  // UI-06: compacted recently (within 5 minutes)
  const compactedRecently = contextStatus.lastCompactedAt
    ? (nowMs - Date.parse(contextStatus.lastCompactedAt)) < 5 * 60 * 1000
    : false;

  // UI-05: stale freshness
  const isStale = contextStatus.freshness === "stale";

  return { label, threshold, visible: true, compactedRecently, isStale, lastUpdatedLabel: null };
}
```

### Badge Variant Mapping

```typescript
// Mapping threshold to existing Badge variants
import type { ContextThreshold } from "./contextStatusIndicator.logic";

const THRESHOLD_BADGE_VARIANT: Record<ContextThreshold, "outline" | "info" | "warning" | "error"> = {
  neutral: "outline",
  watch: "info",
  warning: "warning",
  danger: "error",
};
```

### Debounced Context Status Hook

```typescript
// Using @tanstack/react-pacer's useDebouncedValue for hysteresis (UI-07)
import { useDebouncedValue } from "@tanstack/react-pacer";

function useContextStatusDisplay(threadId: ThreadId) {
  const thread = useThread(threadId);
  const sessionActive = thread?.session !== null &&
    thread.session.status !== "closed" &&
    thread.session.orchestrationStatus !== "stopped";

  const rawDisplay = useMemo(
    () => deriveContextStatusDisplay(thread?.contextStatus ?? null, sessionActive, Date.now()),
    [thread?.contextStatus, sessionActive],
  );

  // UI-07: 500ms debounce minimum to prevent visual flicker
  const [debouncedDisplay] = useDebouncedValue(rawDisplay, { wait: 500 });
  return debouncedDisplay;
}
```

### Component Rendering in Composer Footer

```typescript
// Placement: after the runtime mode toggle, before the right-side actions
// Following existing pattern of Separator + Button/Badge in the footer
{contextStatusDisplay.visible && (
  <>
    {!composerCompact && (
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
    )}
    <ContextStatusIndicator display={contextStatusDisplay} />
  </>
)}
```

### Test Pattern

```typescript
// contextStatusIndicator.logic.test.ts -- following session-logic.test.ts pattern
import { describe, expect, it } from "vitest";
import { deriveContextThreshold, deriveContextStatusDisplay } from "./contextStatusIndicator.logic";

describe("deriveContextThreshold", () => {
  it("returns neutral below 70%", () => {
    expect(deriveContextThreshold(69)).toBe("neutral");
  });
  it("returns watch at 70%", () => {
    expect(deriveContextThreshold(70)).toBe("watch");
  });
  it("returns warning at 85%", () => {
    expect(deriveContextThreshold(85)).toBe("warning");
  });
  it("returns danger at 95%", () => {
    expect(deriveContextThreshold(95)).toBe("danger");
  });
  it("returns neutral for undefined percent", () => {
    expect(deriveContextThreshold(undefined)).toBe("neutral");
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No context status display | Phase 7-9 server pipeline complete | 2026-03-13 | `OrchestrationThread.contextStatus` field exists and is populated on every snapshot push |
| `Schema.Unknown` for token usage | `NormalizedTokenUsage` typed schema | Phase 7 (2026-03-13) | All token fields are typed; web can safely access `percent`, `totalTokens`, etc. |
| No feature flag system | Vite env vars for dev config | Pre-existing | `VITE_WS_URL` establishes the pattern; no formal feature flag library |

**Deprecated/outdated:**
- Nothing deprecated. All relevant APIs are current.

## Key Data Flow (End-to-End)

```
Server: Provider token event
  -> ProviderRuntimeIngestion (throttled 2s per thread)
  -> computeContextStatus (pure function)
  -> Orchestration dispatch: thread.context-status.set
  -> In-memory projector updates OrchestrationThread.contextStatus
  -> Domain event pushed via WebSocket: thread.context-status-set

Web: WebSocket receives orchestration.domainEvent
  -> domainEventFlushThrottler (100ms trailing)
  -> api.orchestration.getSnapshot()
  -> syncServerReadModel(snapshot) -- CURRENTLY DROPS contextStatus
  -> zustand store updated
  -> Component re-renders via useThread()
```

**The gap to fill:** `syncServerReadModel` must map `contextStatus`, and the `Thread` type must include it.

## Key Design Decisions

### 1. UI-Layer Thresholds vs Server-Layer Status

The server `status` field uses: `ok` (< 75%), `watch` (>= 75%), `near-limit` (>= 95%), `compacted`, `unknown`.

The UI requirement specifies: `neutral` (< 70%), `watch` (70-85%), `warning` (85-95%), `danger` (>= 95%).

**Decision:** The UI derives threshold coloring from `percent`, NOT from `status`. The server's `status` field is used for monitoring/logging; the UI has independent threshold bands. This is consistent with the separation of concerns: server decides operational severity, UI decides visual presentation.

### 2. Compaction "Recently" Threshold

The UI-06 requirement says "when last compaction is within threshold". No specific duration is defined. A 5-minute threshold is recommended as a reasonable default -- compaction events are rare (once per long session) and showing the indicator for 5 minutes gives the user adequate notice without being persistent noise.

### 3. Debounce Placement

The 500ms debounce (UI-07) should be applied at the component level using `useDebouncedValue`, NOT at the store level. The store should always have the freshest data for any consumer that needs it. The debounce is specifically for visual rendering stability.

### 4. Badge Placement in Composer Footer

The context status badge should be placed at the END of the left-side controls, before the right-side actions (attach + send/stop). This follows the visual hierarchy: model > mode > runtime > context status. The badge is a passive indicator, not an action, so it belongs after all interactive controls.

## Open Questions

1. **Compaction recency threshold value**
   - What we know: UI-06 says "within threshold" for compaction recency, no specific duration given
   - What's unclear: Whether 5 minutes is the right default
   - Recommendation: Use 5 minutes as default, make it a named constant that's easy to adjust. This is a pure-logic constant, not a user-facing setting.

2. **Stale freshness last-updated formatting**
   - What we know: UI-05 says "shows last updated time" for stale freshness
   - What's unclear: Whether this should be an absolute time ("12:34 PM") or relative ("2 min ago")
   - Recommendation: Use relative time ("Updated 2m ago") in the badge area, absolute time in the tooltip. The existing `formatDuration` utility handles the relative formatting. This matches the established pattern of `formatTimestamp` for details.

## Sources

### Primary (HIGH confidence)

- **Codebase analysis:** `apps/web/src/store.ts` -- zustand store patterns, `syncServerReadModel` mapping, `Debouncer` usage
- **Codebase analysis:** `apps/web/src/types.ts` -- `Thread` interface (confirmed: no `contextStatus` field yet)
- **Codebase analysis:** `apps/web/src/components/ChatView.tsx` -- composer footer layout, component hierarchy, existing controls
- **Codebase analysis:** `packages/contracts/src/orchestration.ts` -- `OrchestrationThreadContextStatus` schema, threshold enums
- **Codebase analysis:** `apps/server/src/provider/normalization/contextStatusComputation.ts` -- server threshold levels (ok < 75%, watch >= 75%, near-limit >= 95%)
- **Codebase analysis:** `apps/web/src/components/ui/badge.tsx` -- existing Badge variants (outline, info, warning, error, success, destructive)
- **Codebase analysis:** `apps/web/src/components/ui/tooltip.tsx` -- existing Tooltip primitives
- **Codebase analysis:** `apps/web/src/session-logic.ts` -- pure logic separation pattern, formatDuration utility
- **Codebase analysis:** `apps/web/src/routes/__root.tsx` -- domain event flow, snapshot sync throttling
- **Codebase analysis:** `apps/web/src/components/composerFooterLayout.ts` -- existing footer layout logic

### Secondary (MEDIUM confidence)

- **Phase 7 verification:** `.planning/phases/07-schema-foundation-and-context-window-registry/07-VERIFICATION.md` -- confirmed all schemas exist and pass typecheck
- **Phase 9 verification:** `.planning/phases/09-server-pipeline-and-persistence/09-VERIFICATION.md` -- confirmed full pipeline works end-to-end

### Tertiary (LOW confidence)

- None. All findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- all patterns directly observed in existing codebase
- Pitfalls: HIGH -- derived from concrete analysis of data flow and type gaps
- Code examples: HIGH -- modeled after actual codebase patterns

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable; only changes if contracts or store architecture changes)
