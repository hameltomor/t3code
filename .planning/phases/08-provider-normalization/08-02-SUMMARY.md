---
phase: 08-provider-normalization
plan: 02
subsystem: api
tags: [token-usage, normalization, claude-code, gemini, adapter-emission, fixture-tests]

# Dependency graph
requires:
  - phase: 08-provider-normalization
    plan: 01
    provides: normalizeClaudeUsage, normalizeGeminiUsage pure functions and ClaudeRawUsage, GeminiRawUsageMetadata types
provides:
  - Claude Code adapter emitting thread.token-usage.updated on result messages and compact_boundary
  - Gemini adapter emitting thread.token-usage.updated from usageMetadata with lastUsageMetadata turn state tracking
  - Cross-provider normalization fixture tests (9 cases covering Codex, Claude, Gemini)
affects: [09 (ProviderRuntimeIngestion context status dispatch from token usage events)]

# Tech tracking
tech-stack:
  added: []
  patterns: [adapter-token-usage-emission-via-normalization, turn-state-metadata-tracking]

key-files:
  created:
    - apps/server/src/provider/normalization/tokenUsageNormalization.test.ts
  modified:
    - apps/server/src/provider/Layers/ClaudeCodeAdapter.ts
    - apps/server/src/provider/Layers/GeminiAdapter.ts

key-decisions:
  - "Claude Code result usage accessed via defensive type guard (message.usage as Record check) since SDK types use discriminated union"
  - "Compact_boundary emits minimal NormalizedTokenUsage with just totalTokens from pre_tokens metadata"
  - "Gemini adapter stores lastUsageMetadata on GeminiTurnState per turn, emits in completeTurn before clearing state"

patterns-established:
  - "Token usage emission: assign event to intermediate variable + cast as ProviderRuntimeEvent to avoid TS excess property check with providerThreadRef"
  - "Turn-state metadata tracking: store SDK response metadata on mutable turn state for emission in completeTurn"

# Metrics
duration: 7min
completed: 2026-03-13
---

# Phase 8 Plan 2: Claude Code and Gemini Adapter Token Usage Emission Summary

**Claude Code and Gemini adapters wired to emit thread.token-usage.updated events with support tier labels, plus 9 cross-provider normalization fixture tests**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T17:50:30Z
- **Completed:** 2026-03-13T17:58:12Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Claude Code adapter emits token usage on result messages (support=derived-live) and compact_boundary (with pre_tokens)
- Gemini adapter tracks lastUsageMetadata per turn and emits from usageMetadata (support=derived-on-demand)
- 9 fixture tests covering all three normalization functions with real-world payload shapes
- All three provider adapters now emit uniform token usage events with correct support tier labeling

## Task Commits

Each task was committed atomically:

1. **Task 1: Claude Code and Gemini adapter token usage emission** - `96df8409` (feat)
2. **Task 2: Cross-provider normalization fixture tests** - `08f97db2` (test)

## Files Created/Modified
- `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` - Added normalizeClaudeUsage import, token usage emission in handleResultMessage and compact_boundary handler
- `apps/server/src/provider/Layers/GeminiAdapter.ts` - Added normalizeGeminiUsage import, lastUsageMetadata on GeminiTurnState, token usage emission in completeTurn
- `apps/server/src/provider/normalization/tokenUsageNormalization.test.ts` - 9 fixture-based tests for normalizeCodexUsage (3), normalizeClaudeUsage (2), normalizeGeminiUsage (4)

## Decisions Made
- Claude Code SDK result message `usage` accessed via defensive type guard (`typeof usage === "object" && "input_tokens" in usage`) since SDKMessage uses a discriminated union where `usage` is typed as `any` on the base
- Compact_boundary emits minimal NormalizedTokenUsage with just `totalTokens` from `compact_metadata.pre_tokens` -- downstream Phase 9 ingestion will correlate compaction with last known token count
- Gemini adapter stores `lastUsageMetadata` on mutable `GeminiTurnState` to carry SDK response metadata from the tool loop into `completeTurn`
- Token usage events use intermediate variable assignment + `as ProviderRuntimeEvent` cast to work around TS excess property check when `providerThreadRef` returns `providerThreadId` (not in ProviderRefs schema)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript excess property check on token usage event emission**
- **Found during:** Task 1
- **Issue:** Direct inline event object with `providerRefs: { ...providerThreadRef(context) }` fails TS excess property check because `providerThreadRef` returns `{ providerThreadId: string }` which is not in the `ProviderRefs` schema
- **Fix:** Assign event to intermediate variable, then cast as `ProviderRuntimeEvent` when passing to `offerRuntimeEvent`
- **Files modified:** apps/server/src/provider/Layers/ClaudeCodeAdapter.ts
- **Verification:** `bun typecheck` passes
- **Committed in:** 96df8409

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type compatibility fix needed for the established `providerThreadRef` pattern. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three provider adapters (Codex, Claude Code, Gemini) now emit uniform `thread.token-usage.updated` events
- Support tier labels correctly assigned: Codex="native", Claude Code="derived-live", Gemini="derived-on-demand"
- Phase 8 complete -- ready for Phase 9 (ProviderRuntimeIngestion) to consume token usage events and dispatch context status updates

## Self-Check: PASSED

All created files exist, all commits found, all imports and event emissions verified.

---
*Phase: 08-provider-normalization*
*Completed: 2026-03-13*
