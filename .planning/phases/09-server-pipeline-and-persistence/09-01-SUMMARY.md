---
phase: 09-server-pipeline-and-persistence
plan: 01
subsystem: database, api
tags: [sqlite, effect, projection, context-status, normalization]

# Dependency graph
requires:
  - phase: 07-schema-foundation-and-context-window-registry
    provides: OrchestrationThreadContextStatus schema, ContextWindowRegistry, ThreadContextStatusSetPayload
  - phase: 08-provider-normalization
    provides: NormalizedTokenUsage type, tokenUsageNormalization functions
provides:
  - Migration 020 for projection_thread_context_status table
  - ProjectionThreadContextStatusRepository (Service+Layer) with upsert/getByThreadId/deleteByThreadId
  - Pipeline projector persisting context status on thread.context-status-set events
  - In-memory projector updating OrchestrationThread.contextStatus in read model
  - computeContextStatus pure function for deriving status from token usage
affects: [09-02-ingestion-snapshot-hydration, provider-adapters, orchestration-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [supplementary-projector, pure-computation-function, context-status-persistence]

key-files:
  created:
    - apps/server/src/persistence/Migrations/020_ProjectionThreadContextStatus.ts
    - apps/server/src/persistence/Services/ProjectionThreadContextStatus.ts
    - apps/server/src/persistence/Layers/ProjectionThreadContextStatus.ts
    - apps/server/src/provider/normalization/contextStatusComputation.ts
  modified:
    - apps/server/src/persistence/Migrations.ts
    - apps/server/src/orchestration/Layers/ProjectionPipeline.ts
    - apps/server/src/orchestration/projector.ts
    - apps/server/src/orchestration/Schemas.ts

key-decisions:
  - "Context status projector is supplementary (not in REQUIRED_SNAPSHOT_PROJECTORS) per PIPE-07"
  - "DB schema uses Schema.String for enum fields -- enums validated at application layer, not persistence layer"
  - "Compaction detection uses 80% threshold: current totalTokens < previous * 0.8"

patterns-established:
  - "Supplementary projector: projectors that run on specific events but are not required for snapshot consistency"
  - "Pure computation function pattern for deriving domain status from normalized data"

# Metrics
duration: 5min
completed: 2026-03-13
---

# Phase 9 Plan 1: Context Status Persistence and Projection Pipeline Summary

**SQLite migration, repository Service+Layer, pipeline+in-memory projectors, and computeContextStatus pure function for context window status tracking**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T18:27:55Z
- **Completed:** 2026-03-13T18:33:42Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Migration 020 creates projection_thread_context_status table with threadId primary key and all OrchestrationThreadContextStatus fields
- Repository Service+Layer follows established ProjectionThreadSessions pattern with upsert/getByThreadId/deleteByThreadId
- Pipeline projector persists context status to DB on every thread.context-status-set event
- In-memory projector updates OrchestrationThread.contextStatus in the read model
- computeContextStatus pure function converts NormalizedTokenUsage + model info into OrchestrationThreadContextStatus with correct status levels (ok/watch/near-limit/compacted/unknown)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration, repository, and computeContextStatus function** - `8ad9a156` (feat)
2. **Task 2: Pipeline projector and in-memory projector for context status** - `674ba6eb` (feat)

## Files Created/Modified
- `apps/server/src/persistence/Migrations/020_ProjectionThreadContextStatus.ts` - SQLite migration creating projection_thread_context_status table
- `apps/server/src/persistence/Services/ProjectionThreadContextStatus.ts` - Repository service interface with Schema.Struct and ServiceMap.Service
- `apps/server/src/persistence/Layers/ProjectionThreadContextStatus.ts` - Repository layer with SqlSchema-based upsert/get/delete operations
- `apps/server/src/provider/normalization/contextStatusComputation.ts` - Pure function deriving status levels from token usage and context window limits
- `apps/server/src/persistence/Migrations.ts` - Registered migration 020
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` - Added supplementary projector for thread.context-status-set events
- `apps/server/src/orchestration/projector.ts` - Added in-memory projection case for thread.context-status-set
- `apps/server/src/orchestration/Schemas.ts` - Re-exported ThreadContextStatusSetPayload from contracts

## Decisions Made
- Context status projector is supplementary (not in REQUIRED_SNAPSHOT_PROJECTORS) per PIPE-07 -- context status is a different domain from session lifecycle
- DB schema uses Schema.String for enum fields (provider, support, source, freshness, status) -- enums are validated at the application layer, not the persistence layer
- Compaction detection uses 80% threshold: current totalTokens < previous totalTokens * 0.8

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Foundation is ready for Plan 09-02 to wire ingestion (ProviderRuntimeIngestion dispatches thread.context-status.set command on token usage events), snapshot hydration (restore context status from projection table on server restart), and integration tests
- All existing tests pass with no regressions (513 tests, 48 test files)

---
*Phase: 09-server-pipeline-and-persistence*
*Completed: 2026-03-13*
