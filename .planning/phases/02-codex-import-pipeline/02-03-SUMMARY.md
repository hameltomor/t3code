---
phase: 02-codex-import-pipeline
plan: 03
subsystem: api, database
tags: [effect-layer, orchestration-dispatch, deduplication, materializer, ws-handlers, history-import]

# Dependency graph
requires:
  - phase: 02-codex-import-pipeline
    plan: 01
    provides: "Codex JSONL schemas, CodexHistoryScannerService, import orchestration commands, error types"
  - phase: 02-codex-import-pipeline
    plan: 02
    provides: "CodexRolloutParserService, HistoryImportServiceService (list/preview), HistoryImportCatalogRepository.getByCatalogId"
provides:
  - "HistoryMaterializerService and HistoryMaterializerLive layer"
  - "HistoryImportService.execute method (was stub)"
  - "Functional WS method handlers for historyImport.list, preview, execute, listThreadLinks"
  - "All import layers wired into serverLayers.ts"
  - "Complete end-to-end Codex import pipeline: scan -> catalog -> preview -> import -> thread"
affects: [phase-03, phase-04, phase-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [sequential-dispatch-for-ordering, branded-type-safe-decode, dedup-via-read-model, layer-composition-with-provideMerge]

key-files:
  created:
    - apps/server/src/historyImport/Services/HistoryMaterializer.ts
    - apps/server/src/historyImport/Layers/HistoryMaterializer.ts
  modified:
    - apps/server/src/historyImport/Layers/HistoryImportService.ts
    - apps/server/src/wsServer.ts
    - apps/server/src/serverLayers.ts

key-decisions:
  - "Messages and activities dispatched sequentially to preserve ordering (no parallel dispatch)"
  - "Deduplication via providerThreadId lookup on orchestration read model, not database query"
  - "TurnId safely decoded via Schema.decodeUnknownOption to avoid unsafe brand cast"
  - "Avoided try/catch inside Effect generators -- used Effect.catch + Effect.mapError for error propagation"
  - "HistoryMaterializerLive depends on OrchestrationEngineService via Layer.provideMerge(orchestrationLayer)"

patterns-established:
  - "Import materializer pattern: yield services at layer construction, dispatch commands in loop, persist external link, return result"
  - "WS handler pattern for history import: stripRequestTag(request.body), delegate to service, mapError to RouteRequestError"
  - "Layer wiring: history import layers composed into historyImportLayers const, merged into final Layer.mergeAll"

# Metrics
duration: 9min
completed: 2026-03-12
---

# Phase 02 Plan 03: Import Materializer, WS Handlers, and Layer Wiring Summary

**HistoryMaterializer that creates XBE threads from parsed Codex transcripts via sequential orchestration dispatch, functional WS method handlers replacing all stubs, and complete layer composition in serverLayers.ts**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-12T09:40:34Z
- **Completed:** 2026-03-12T09:50:02Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- HistoryMaterializer service and layer that creates XBE threads from parsed Codex transcripts by dispatching thread.create, thread.message.import, and thread.activity.import commands -- no provider lifecycle triggered
- Deduplication prevents re-importing same Codex session via providerThreadId read model check
- ThreadExternalLink persisted after successful import with fingerprint, link mode, and source metadata
- HistoryImportService.execute replaced from stub to full implementation: catalog lookup -> full parse -> materialize into XBE thread
- All 5 historyImport WS methods functional (list, preview, execute, listThreadLinks work; validateLink deferred to Phase 5)
- Phase 1 persistence layers (HistoryImportCatalogRepositoryLive, ThreadExternalLinkRepositoryLive) wired into serverLayers.ts -- were missing
- All history import layers properly composed and available to WS server

## Task Commits

Each task was committed atomically:

1. **Task 1: Create HistoryMaterializer and complete HistoryImportService.execute** - `4362ef33` (feat)
2. **Task 2: Replace WS method stubs and wire layers into serverLayers** - `af8e9309` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `apps/server/src/historyImport/Services/HistoryMaterializer.ts` - Service interface with MaterializeInput type and HistoryMaterializerService tag
- `apps/server/src/historyImport/Layers/HistoryMaterializer.ts` - Layer implementation: dedup check, thread creation, sequential message/activity dispatch, external link persistence
- `apps/server/src/historyImport/Layers/HistoryImportService.ts` - Replaced execute stub with real implementation using parser and materializer
- `apps/server/src/wsServer.ts` - Replaced 5 historyImport stub cases with real handlers delegating to services; added HistoryImportServiceService and ThreadExternalLinkRepository to ServerRuntimeServices
- `apps/server/src/serverLayers.ts` - Added 6 history import layer imports and composed historyImportLayers into Layer.mergeAll

## Decisions Made
- Messages and activities dispatched sequentially (not in parallel) to preserve event ordering -- parallel dispatch would overwhelm the orchestration queue and produce out-of-order events
- Deduplication check uses orchestration read model (`readModel.threads.find`) rather than a dedicated database query -- simpler and consistent with existing patterns
- TurnId decoded via `Schema.decodeUnknownOption(TurnId)` returning `Option<TurnId>` -- safely handles invalid/empty strings without unsafe brand cast
- Avoided try/catch inside Effect generators (TS15 lint rule) -- restructured to use `Effect.catch` and `Effect.mapError` for error propagation
- Checked `_tag` property instead of `instanceof` for error type discrimination (TS45 lint rule)
- HistoryMaterializerLive composed with `Layer.provideMerge(orchestrationLayer)` to get OrchestrationEngineService, then historyImportLayers merged into the final layer tree

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed try/catch inside Effect generators**
- **Found during:** Task 1
- **Issue:** Plan suggested wrapping dispatch loops in try/catch for partial import handling, but the project's TypeScript config treats `tryCatchInEffectGen` as an error (TS15)
- **Fix:** Removed try/catch blocks, restructured to use `Effect.catch` on the dispatch loop effects instead
- **Files modified:** `apps/server/src/historyImport/Layers/HistoryMaterializer.ts`
- **Verification:** `bun typecheck` passes without TS15 errors
- **Committed in:** 4362ef33 (Task 1 commit)

**2. [Rule 1 - Bug] Replaced instanceof with _tag check for Schema error types**
- **Found during:** Task 1
- **Issue:** Using `instanceof HistoryImportMaterializeError` triggers TS45 warning (`instanceOfSchema`), which is treated as error
- **Fix:** Changed to `"_tag" in error && error._tag === "HistoryImportMaterializeError"` pattern
- **Files modified:** `apps/server/src/historyImport/Layers/HistoryMaterializer.ts`
- **Verification:** `bun typecheck` passes without TS45 warnings
- **Committed in:** 4362ef33 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes for Effect TypeScript lint rules)
**Impact on plan:** Both fixes necessary for TypeScript compilation. No scope creep.

## Issues Encountered
- Effect TypeScript plugin treats `tryCatchInEffectGen` (TS15) and `instanceOfSchema` (TS45) as errors, requiring restructuring from plan's suggested approach
- `OrchestrationEngineService.Type` cannot be used as a function parameter type (it's a class, not just a type) -- resolved by inlining dispatch logic instead of extracting helper functions

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete end-to-end Codex import pipeline operational: scan -> catalog -> preview -> import -> thread
- All WS methods functional (except validateLink, deferred to Phase 5)
- Phase 2 is complete -- ready for Phase 3 (Claude Code Import)
- All code compiles and lints cleanly

## Self-Check: PASSED

All created files verified present. All task commit hashes verified in git log.

---
*Phase: 02-codex-import-pipeline*
*Completed: 2026-03-12*
