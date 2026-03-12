---
phase: 02-codex-import-pipeline
plan: 01
subsystem: database, api
tags: [effect-schema, sqlite, jsonl, codex, tinyglobby, fingerprint, orchestration]

# Dependency graph
requires:
  - phase: 01-foundation-and-schema
    provides: "HistoryImportCatalogRepository, orchestration contracts, persistence layer"
provides:
  - "Codex JSONL rollout line schemas (CodexRolloutLine, CodexSessionMetaLine, etc.)"
  - "History import domain error types (Scan, Parse, Materialize, NotFound)"
  - "thread.message.import and thread.activity.import orchestration commands"
  - "CodexHistoryScannerService and CodexHistoryScannerLive layer"
  - "Rollout file fingerprinting (session ID + size + mtime + head/tail SHA-256)"
affects: [02-02-PLAN, 02-03-PLAN, phase-03]

# Tech tracking
tech-stack:
  added: [tinyglobby]
  patterns: [scoped-sqlite-connection, schema-tolerant-parsing, import-without-lifecycle]

key-files:
  created:
    - apps/server/src/historyImport/Schemas/CodexRolloutSchemas.ts
    - apps/server/src/historyImport/Errors.ts
    - apps/server/src/historyImport/Services/CodexHistoryScanner.ts
    - apps/server/src/historyImport/Layers/CodexHistoryScanner.ts
  modified:
    - packages/contracts/src/orchestration.ts
    - apps/server/src/orchestration/decider.ts
    - apps/server/package.json

key-decisions:
  - "Used Effect.catch (not catchAll) per Effect v4 API for error recovery in scanner"
  - "Dynamic SQLite loader with runtime detection (bun vs node) for Codex DB connection"
  - "Import commands reuse existing event types (thread.message-sent, thread.activity-appended) without triggering provider lifecycle"
  - "Fixed thread.create decider to pass providerThreadId to thread.created event payload"

patterns-established:
  - "Scoped SQLite connection: create temporary read-only SQL client for external databases, provide it locally via Effect.provide"
  - "Schema tolerance: annotate with { parseOptions: { onExcessProperty: 'ignore' } } for forward-compatible JSONL parsing"
  - "Import orchestration pattern: new command types produce existing event types to materialize data without side effects"

# Metrics
duration: 8min
completed: 2026-03-12
---

# Phase 02 Plan 01: Codex Schemas and Scanner Summary

**Codex JSONL rollout schemas with tolerant parsing, import-specific orchestration commands that bypass provider lifecycle, and CodexHistoryScanner that discovers sessions from state_5.sqlite with fingerprinted catalog entries**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-12T09:14:14Z
- **Completed:** 2026-03-12T09:22:47Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Codex rollout JSONL schemas (CodexRolloutLine, CodexSessionMetaLine, CodexResponseItem, CodexCompactedItem, CodexTurnContext, CodexEventMsg) with schema-tolerant excess property handling
- Four tagged error types for history import domain (Scan, Parse, Materialize, NotFound)
- Two new internal orchestration commands (thread.message.import, thread.activity.import) that produce existing event types without triggering turn lifecycle
- Fixed thread.create decider to pass providerThreadId through to thread.created payload
- CodexHistoryScanner service and layer that opens Codex state_5.sqlite read-only, queries threads filtered by workspace root, computes rollout file fingerprints, and upserts results into the import catalog

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Codex rollout schemas, import errors, and import orchestration commands** - `14bc4731` (feat)
2. **Task 2: Create CodexHistoryScanner service and layer with tinyglobby** - `1d5b1274` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `apps/server/src/historyImport/Schemas/CodexRolloutSchemas.ts` - Effect schemas for all Codex JSONL rollout line variants with tolerant parsing
- `apps/server/src/historyImport/Errors.ts` - Tagged error types for history import domain
- `apps/server/src/historyImport/Services/CodexHistoryScanner.ts` - Service interface with scan() method
- `apps/server/src/historyImport/Layers/CodexHistoryScanner.ts` - Layer implementation: SQLite query, glob resolution, fingerprinting, catalog upsert
- `packages/contracts/src/orchestration.ts` - Added ThreadMessageImportCommand and ThreadActivityImportCommand to InternalOrchestrationCommand union
- `apps/server/src/orchestration/decider.ts` - Added thread.message.import and thread.activity.import cases; fixed thread.create to pass providerThreadId
- `apps/server/package.json` - Added tinyglobby dependency

## Decisions Made
- Used `Effect.catch` (not `Effect.catchAll`) per Effect v4 API conventions in the scanner layer
- Created dynamic SQLite loader with bun/node runtime detection for the Codex database connection, matching the pattern in `persistence/Layers/Sqlite.ts`
- Import commands (`thread.message.import`, `thread.activity.import`) intentionally produce the SAME event types as existing commands but do NOT emit `thread.turn-start-requested`, which is the key design decision enabling import without provider lifecycle side effects
- Fixed existing bug where `thread.create` decider did not pass `providerThreadId` through to the `thread.created` event payload -- critical for imported threads to retain their Codex session ID

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed thread.create not passing providerThreadId**
- **Found during:** Task 1 (as specified in plan)
- **Issue:** The decider's `thread.create` case did not include `providerThreadId` in the `thread.created` payload
- **Fix:** Added `providerThreadId: command.providerThreadId ?? null` to the payload
- **Files modified:** `apps/server/src/orchestration/decider.ts`
- **Verification:** `bun typecheck` passes, exhaustive switch still satisfied
- **Committed in:** 14bc4731 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, was part of the plan)
**Impact on plan:** Planned fix, no scope creep.

## Issues Encountered
- Effect v4 uses `Effect.catch` instead of `Effect.catchAll` -- adjusted all error recovery patterns to use the correct API
- Dynamic SQLite loader required explicit type aliasing (`SqliteLoader`) to unify bun and node client module types
- Service key naming convention required full path with class name suffix per Effect convention

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Codex rollout schemas ready for Plan 02 (rollout parser)
- CodexHistoryScanner ready for integration with the import service in Plan 03
- Import orchestration commands ready for the materializer in Plan 02/03
- All code compiles and lints cleanly

## Self-Check: PASSED

All created files verified present. All task commit hashes verified in git log.

---
*Phase: 02-codex-import-pipeline*
*Completed: 2026-03-12*
