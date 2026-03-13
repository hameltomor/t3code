---
phase: 09-server-pipeline-and-persistence
plan: 02
subsystem: api, database
tags: [effect, orchestration, ingestion, projection, context-status, throttle, integration-test]

# Dependency graph
requires:
  - phase: 09-server-pipeline-and-persistence
    plan: 01
    provides: Migration 020, ProjectionThreadContextStatusRepository, pipeline projector, in-memory projector, computeContextStatus function
  - phase: 08-provider-normalization
    provides: NormalizedTokenUsage type, token usage event emission from provider adapters
provides:
  - ProviderRuntimeIngestion handler for thread.token-usage.updated with throttle/dedup
  - ProjectionSnapshotQuery hydration of contextStatus from projection table
  - Integration tests verifying full context status pipeline
affects: [10-ui-context-status-badge, provider-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns: [ingestion-throttle-dedup, snapshot-hydration-from-projection, graceful-dispatch-failure]

key-files:
  modified:
    - apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
    - apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
    - apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts

key-decisions:
  - "Effect.catch used instead of Effect.catchAll for dispatch failure handling (effect-smol API)"
  - "Throttle uses in-memory Map per thread, not Cache, for simplicity and zero GC overhead"
  - "Test uses gpt-5.3-codex model to ensure context window limit resolves for status level assertion"

patterns-established:
  - "Ingestion-side throttle: per-thread Map tracking last dispatch time + last totalTokens for dedup"
  - "Graceful dispatch failure: Effect.catch on dispatch errors logs warning, never blocks ingestion queue"
  - "Snapshot hydration: projection table rows loaded in same Effect.all transaction as other snapshot data"

# Metrics
duration: 8min
completed: 2026-03-13
---

# Phase 9 Plan 2: Ingestion, Snapshot Hydration, and Integration Tests Summary

**Token usage ingestion handler with 2-second throttle/dedup, snapshot context status hydration from projection table, and integration tests verifying the full pipeline**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-13T18:36:49Z
- **Completed:** 2026-03-13T18:44:51Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- ProviderRuntimeIngestion handles thread.token-usage.updated events, computes context status via computeContextStatus, and dispatches thread.context-status.set to the orchestration engine
- Ingestion-side throttle prevents excessive dispatches: minimum 2-second interval per thread AND totalTokens change detection
- ProjectionSnapshotQuery hydrates contextStatus from projection_thread_context_status table with graceful fallback to null
- Context status dispatch failures caught and logged without blocking the ingestion queue (PIPE-08)
- Integration tests verify full pipeline: token usage event -> ingestion -> dispatch -> read model, and throttle dedup behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Ingestion handler and snapshot hydration for context status** - `c5984027` (feat)
2. **Task 2: Integration test for end-to-end context status pipeline** - `dcdedec7` (test)

## Files Created/Modified
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` - Added token usage event handler with throttle/dedup and context status dispatch
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` - Added SQL query and hydration for contextStatus from projection_thread_context_status table
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` - Added 2 integration tests for context status pipeline and throttle behavior

## Decisions Made
- Effect.catch used instead of Effect.catchAll -- the effect-smol branch uses different API surface
- Throttle uses in-memory Map per thread for simplicity and zero GC overhead (no Effect Cache needed for simple timestamp tracking)
- Test uses gpt-5.3-codex model (which exists in ContextWindowRegistry) to ensure percent calculation produces "ok" status

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Effect.catchAll does not exist in effect-smol, replaced with Effect.catch**
- **Found during:** Task 1 (Ingestion handler implementation)
- **Issue:** Plan specified Effect.catchAll for dispatch failure handling, but the effect-smol branch uses Effect.catch instead
- **Fix:** Replaced Effect.catchAll with Effect.catch
- **Files modified:** apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
- **Verification:** bun typecheck passes
- **Committed in:** c5984027 (Task 1 commit)

**2. [Rule 1 - Bug] Test model gpt-5-codex not in ContextWindowRegistry**
- **Found during:** Task 2 (Integration test)
- **Issue:** Test harness creates thread with model "gpt-5-codex" which doesn't exist in the registry, causing status to be "unknown" instead of "ok"
- **Fix:** Added thread.meta.update dispatch to set model to "gpt-5.3-codex" before emitting token usage event
- **Files modified:** apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
- **Verification:** Both tests pass
- **Committed in:** dcdedec7 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full end-to-end context status pipeline is operational: provider adapters emit token usage -> ingestion dispatches context status -> projection persists -> snapshot hydrates
- Phase 9 complete: all server-side infrastructure for context status is ready
- Phase 10 (UI Context Status Badge) can now render contextStatus from OrchestrationThread

---
*Phase: 09-server-pipeline-and-persistence*
*Completed: 2026-03-13*
