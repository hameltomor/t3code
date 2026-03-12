---
phase: 01-foundation-and-schema
plan: 02
subsystem: database
tags: [sqlite, migrations, effect-layer, repository, projection-pipeline, websocket]

# Dependency graph
requires:
  - phase: 01-01
    provides: History import contract schemas, providerThreadId on orchestration types, WS method tags
provides:
  - 3 database migrations (history_import_catalog, thread_external_links, provider_thread_id column)
  - HistoryImportCatalogRepository service and layer (upsert, listByWorkspace, deleteByCatalogId)
  - ThreadExternalLinkRepository service and layer (upsert, getByThreadId, listByThreadId, deleteByThreadId)
  - providerThreadId wired end-to-end through projection pipeline (write on thread.created, read in snapshot query)
  - 5 historyImport WS method stub handlers in wsServer.ts
affects: [02-codex-scanner, 03-server-endpoints, 04-claude-code-scanner, 05-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-query dispatch pattern for optional WHERE filters in SqlSchema (listByWorkspaceAll vs listByWorkspaceAndProvider)"
    - "Partial unique index pattern for nullable unique columns (provider_thread_id WHERE IS NOT NULL)"
    - "Stub handler pattern for WS methods returning RouteRequestError before real implementation"

key-files:
  created:
    - apps/server/src/persistence/Migrations/017_HistoryImportCatalog.ts
    - apps/server/src/persistence/Migrations/018_ThreadExternalLinks.ts
    - apps/server/src/persistence/Migrations/019_ProjectionThreadsProviderThreadId.ts
    - apps/server/src/persistence/Services/HistoryImportCatalog.ts
    - apps/server/src/persistence/Services/ThreadExternalLinks.ts
    - apps/server/src/persistence/Layers/HistoryImportCatalog.ts
    - apps/server/src/persistence/Layers/ThreadExternalLinks.ts
  modified:
    - apps/server/src/persistence/Migrations.ts
    - apps/server/src/persistence/Services/ProjectionThreads.ts
    - apps/server/src/persistence/Layers/ProjectionThreads.ts
    - apps/server/src/orchestration/Layers/ProjectionPipeline.ts
    - apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
    - apps/server/src/wsServer.ts

key-decisions:
  - "Used two-query dispatch pattern for optional providerName filter in HistoryImportCatalogRepository.listByWorkspace since SqlSchema does not support conditional WHERE clauses"
  - "Replaced hardcoded providerThreadId: null in ProjectionSnapshotQuery with row.providerThreadId ?? null now that DB column exists"

patterns-established:
  - "Repository service + layer pattern extended to history import domain following ProjectionDrafts as reference"
  - "WS method stubs return RouteRequestError directly without requiring any service dependencies"

# Metrics
duration: 5min
completed: 2026-03-12
---

# Phase 1 Plan 02: Database Migrations and Repository Layers Summary

**3 SQLite migrations, 2 repository services with Effect layers, providerThreadId wired end-to-end through projection pipeline, and 5 WS method stubs**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-12T08:16:12Z
- **Completed:** 2026-03-12T08:21:30Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- Created 3 database migrations: history_import_catalog table, thread_external_links table, and provider_thread_id column on projection_threads with partial unique index
- Built HistoryImportCatalogRepository and ThreadExternalLinkRepository with full CRUD operations following the established Effect Layer pattern
- Wired providerThreadId through the complete projection pipeline: write on thread.created, persist via SQL, read back in snapshot query
- Added 5 historyImport WS method stub handlers satisfying the exhaustive switch in wsServer.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migrations, repository services, and layer implementations** - `0cb4abcf` (feat)
2. **Task 2: Wire providerThreadId through projection pipeline and add WS method stubs** - `9b6d2bae` (feat)

## Files Created/Modified
- `apps/server/src/persistence/Migrations/017_HistoryImportCatalog.ts` - CREATE TABLE history_import_catalog with workspace index
- `apps/server/src/persistence/Migrations/018_ThreadExternalLinks.ts` - CREATE TABLE thread_external_links with provider index
- `apps/server/src/persistence/Migrations/019_ProjectionThreadsProviderThreadId.ts` - ALTER TABLE projection_threads ADD COLUMN provider_thread_id with partial unique index
- `apps/server/src/persistence/Migrations.ts` - Registered migrations 017, 018, 019
- `apps/server/src/persistence/Services/HistoryImportCatalog.ts` - HistoryImportCatalogEntry schema and repository service interface
- `apps/server/src/persistence/Services/ThreadExternalLinks.ts` - ThreadExternalLinkEntry schema and repository service interface
- `apps/server/src/persistence/Layers/HistoryImportCatalog.ts` - HistoryImportCatalogRepositoryLive layer with upsert, listByWorkspace, deleteByCatalogId
- `apps/server/src/persistence/Layers/ThreadExternalLinks.ts` - ThreadExternalLinkRepositoryLive layer with upsert, getByThreadId, listByThreadId, deleteByThreadId
- `apps/server/src/persistence/Services/ProjectionThreads.ts` - Added providerThreadId to ProjectionThread schema
- `apps/server/src/persistence/Layers/ProjectionThreads.ts` - Added provider_thread_id to INSERT, ON CONFLICT, and SELECT queries
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` - Wire providerThreadId on thread.created upsert
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` - Read provider_thread_id from DB, pass through to OrchestrationThread mapping
- `apps/server/src/wsServer.ts` - Added 5 historyImport stub case handlers returning not-implemented errors

## Decisions Made
- Used two-query dispatch pattern for optional providerName filter in listByWorkspace -- SqlSchema does not support conditional WHERE clauses, so two pre-built queries are dispatched based on whether providerName is defined
- Replaced hardcoded `providerThreadId: null` in ProjectionSnapshotQuery with `row.providerThreadId ?? null` now that the DB migration adding the column exists

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All persistence infrastructure for history import is in place (tables, repositories, layers)
- providerThreadId flows end-to-end through the projection pipeline
- WS method stubs are routed and ready for real implementations in Phase 2/3
- Phase 1 is now complete -- all foundation schemas and database infrastructure are ready

## Self-Check: PASSED

- [x] apps/server/src/persistence/Migrations/017_HistoryImportCatalog.ts exists
- [x] apps/server/src/persistence/Migrations/018_ThreadExternalLinks.ts exists
- [x] apps/server/src/persistence/Migrations/019_ProjectionThreadsProviderThreadId.ts exists
- [x] apps/server/src/persistence/Services/HistoryImportCatalog.ts exists
- [x] apps/server/src/persistence/Services/ThreadExternalLinks.ts exists
- [x] apps/server/src/persistence/Layers/HistoryImportCatalog.ts exists
- [x] apps/server/src/persistence/Layers/ThreadExternalLinks.ts exists
- [x] 01-02-SUMMARY.md exists
- [x] Commit 0cb4abcf exists
- [x] Commit 9b6d2bae exists

---
*Phase: 01-foundation-and-schema*
*Completed: 2026-03-12*
