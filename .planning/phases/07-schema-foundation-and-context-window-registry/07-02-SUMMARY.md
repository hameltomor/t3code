---
phase: 07-schema-foundation-and-context-window-registry
plan: 02
subsystem: shared
tags: [context-window, model-registry, decider, event-sourcing]

# Dependency graph
requires:
  - phase: 07-01
    provides: "ThreadContextStatusSetCommand, ThreadContextStatusSetPayload, thread.context-status-set event type in contracts"
provides:
  - ContextWindowLimit interface for model token limit resolution
  - getContextWindowLimit function with direct lookup and alias resolution chain
  - CONTEXT_WINDOW_LIMITS map covering all 14 catalog models with source comments
  - Decider case for thread.context-status.set command producing thread.context-status-set event
affects: [08, 09, 10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function registry pattern: static map + normalizeModelSlug alias chain, no Effect Service/Layer needed"

key-files:
  created: []
  modified:
    - packages/shared/src/model.ts
    - packages/shared/src/model.test.ts
    - apps/server/src/orchestration/decider.ts
    - apps/server/src/orchestration/projector.test.ts

key-decisions:
  - "Registry is pure functions (not an Effect Service/Layer) since it has no side effects or dependencies"
  - "CONTEXT_WINDOW_LIMITS is internal (not exported) to keep the API surface minimal and allow future refactoring"
  - "getContextWindowLimit returns null for unknown models, never guesses or falls back to defaults"

patterns-established:
  - "Pure-function registry: CONTEXT_WINDOW_LIMITS map + getContextWindowLimit with normalizeModelSlug alias chain for model metadata lookup"

# Metrics
duration: 4min
completed: 2026-03-13
---

# Phase 7 Plan 2: Context Window Registry and Decider Wiring Summary

**ContextWindowRegistry with getContextWindowLimit for all 14 catalog models, plus decider case for thread.context-status.set command**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T17:03:17Z
- **Completed:** 2026-03-13T17:07:25Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Implemented ContextWindowLimit interface and CONTEXT_WINDOW_LIMITS map covering all 14 models across Codex, Claude Code, and Gemini providers with source comments and confidence annotations
- Implemented getContextWindowLimit function with direct slug lookup, provider-specific alias resolution, and cross-provider alias fallback
- Wired thread.context-status.set command in decider to produce thread.context-status-set event, resolving the exhaustive-switch type error from 07-01
- Added 8 test cases covering direct lookup, alias resolution (with and without provider hint), null/undefined handling, full catalog coverage validation, and alias variants

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement ContextWindowRegistry in packages/shared/src/model.ts with tests** - `e6fe7257` (feat)
2. **Task 2: Wire thread.context-status.set command in the decider** - `bf283c1e` (feat)

## Files Created/Modified
- `packages/shared/src/model.ts` - Added ContextWindowLimit interface, CONTEXT_WINDOW_LIMITS map, getContextWindowLimit function
- `packages/shared/src/model.test.ts` - Added 8 tests for getContextWindowLimit covering direct lookup, alias resolution, null handling, catalog coverage
- `apps/server/src/orchestration/decider.ts` - Added thread.context-status.set case in exhaustive switch
- `apps/server/src/orchestration/projector.test.ts` - Added contextStatus: null to expected thread assertion

## Decisions Made
- Registry uses pure functions rather than Effect Service/Layer since there are no side effects or dependencies
- CONTEXT_WINDOW_LIMITS map is not exported (internal) to keep API surface minimal and allow future refactoring without breaking consumers
- getContextWindowLimit returns null for unknown models -- never guesses or falls back to defaults (REG-03)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed projector test missing contextStatus field in expected thread**
- **Found during:** Task 2 (decider wiring verification)
- **Issue:** projector.test.ts "applies thread.created events" test was missing contextStatus: null in its expected thread object, causing assertion failure after 07-01 added contextStatus to OrchestrationThread
- **Fix:** Added `contextStatus: null` to the expected thread assertion
- **Files modified:** apps/server/src/orchestration/projector.test.ts
- **Verification:** All 504 server tests pass
- **Committed in:** bf283c1e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for test correctness -- leftover from 07-01 schema addition. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ContextWindowRegistry is ready for Phase 8 adapters to compute context percentages
- Decider handles thread.context-status.set command, completing the event-sourced pipeline for context status
- Projector handler for thread.context-status-set event will be needed when Phase 8 wires context status updates into the projection
- Full workspace typecheck (7/7 packages), lint (0 errors), and all tests (shared: 48, server: 504) pass

---
*Phase: 07-schema-foundation-and-context-window-registry*
*Completed: 2026-03-13*
