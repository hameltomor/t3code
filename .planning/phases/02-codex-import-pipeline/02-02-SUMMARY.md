---
phase: 02-codex-import-pipeline
plan: 02
subsystem: api, database
tags: [effect-stream, jsonl-parser, compaction, streaming, history-import, preview]

# Dependency graph
requires:
  - phase: 02-codex-import-pipeline
    plan: 01
    provides: "Codex JSONL schemas, CodexHistoryScannerService, HistoryImportCatalogRepository, error types"
provides:
  - "CodexRolloutParserService with streaming JSONL parsing, compaction handling, and preview caps"
  - "HistoryImportServiceService with list() and preview() methods"
  - "HistoryImportCatalogRepository.getByCatalogId for single-entry lookup"
affects: [02-03-PLAN, phase-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [streaming-jsonl-parser, compaction-reset, capped-preview, scan-failure-isolation]

key-files:
  created:
    - apps/server/src/historyImport/Services/CodexRolloutParser.ts
    - apps/server/src/historyImport/Layers/CodexRolloutParser.ts
    - apps/server/src/historyImport/Services/HistoryImportService.ts
    - apps/server/src/historyImport/Layers/HistoryImportService.ts
  modified:
    - apps/server/src/persistence/Services/HistoryImportCatalog.ts
    - apps/server/src/persistence/Layers/HistoryImportCatalog.ts

key-decisions:
  - "Acquired FileSystem at layer construction time to prevent context leaking into parse method return type"
  - "Used Schema.decodeUnknownOption for tolerant per-line schema parsing instead of Schema.decodeUnknownSync"
  - "Catalog entries cast to HistoryImportConversationSummary since catalog is written by our own scan code with valid data"
  - "Used SqlSchema.findOneOption for getByCatalogId to return Option<Entry> then map to nullable"

patterns-established:
  - "Streaming JSONL parser: Stream FileSystem bytes -> decodeText -> splitLines -> stateful fold with mutation"
  - "Compaction reset: on compacted event, discard all accumulated messages/activities and rebuild from replacement_history"
  - "Capped preview: maxMessages/maxActivities options prevent full-file processing for preview use case"
  - "Scan failure isolation (NFR-4): individual provider scan failures logged as warnings without blocking other providers"

# Metrics
duration: 11min
completed: 2026-03-12
---

# Phase 02 Plan 02: Streaming Parser and Import Service Summary

**Streaming Codex JSONL parser with compaction handling, encrypted reasoning skip, and HistoryImportService providing list/preview API with capped message sampling**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-12T09:25:54Z
- **Completed:** 2026-03-12T09:37:18Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- CodexRolloutParser that streams JSONL files line-by-line via Effect FileSystem without full-file loading (NFR-1)
- Compaction reset (Pitfall 1): properly discards pre-compaction messages and rebuilds from replacement_history
- Encrypted reasoning content skipped entirely with warnings (Pitfall 4)
- Streaming/incomplete messages force-completed in post-processing (Pitfall 8)
- HistoryImportService.list triggers Codex scan and returns catalog entries with scan failure isolation (NFR-4)
- HistoryImportService.preview returns capped message/activity sample with total counts and warnings
- getByCatalogId added to HistoryImportCatalogRepository for single-entry lookup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CodexRolloutParser with streaming JSONL parsing and compaction handling** - `151b00f3` (feat)
2. **Task 2: Create HistoryImportService with list/preview and add getByCatalogId to catalog** - `d31b27c4` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `apps/server/src/historyImport/Services/CodexRolloutParser.ts` - Service interface with ParsedCodexMessage, ParsedCodexActivity, CodexRolloutParseResult types
- `apps/server/src/historyImport/Layers/CodexRolloutParser.ts` - Streaming parser layer: line-by-line JSONL parsing, compaction reset, encrypted reasoning skip, message capping
- `apps/server/src/historyImport/Services/HistoryImportService.ts` - Service interface with list, preview, execute methods and HistoryImportError union type
- `apps/server/src/historyImport/Layers/HistoryImportService.ts` - Layer implementation: list with scan+catalog, preview with parser caps, execute stub
- `apps/server/src/persistence/Services/HistoryImportCatalog.ts` - Added getByCatalogId to HistoryImportCatalogRepositoryShape interface
- `apps/server/src/persistence/Layers/HistoryImportCatalog.ts` - Added getByCatalogId implementation using SqlSchema.findOneOption

## Decisions Made
- Acquired `FileSystem.FileSystem` at layer construction time (`yield* FileSystem.FileSystem` in `makeCodexRolloutParser`) to prevent the `FileSystem` context requirement from leaking into the `parse` method's return type, which would violate the service shape contract
- Used `Schema.decodeUnknownOption` for per-line schema validation instead of `Schema.decodeUnknownSync` -- returns Option rather than throwing, enabling graceful skip of malformed lines
- Cast catalog entries to `HistoryImportConversationSummary` since catalog data is written by our own scan code and is always valid. Comment documents the safety rationale.
- Used `SqlSchema.findOneOption` (not `findOne`) for `getByCatalogId` because `findOne` throws `NoSuchElementError` on miss, while `findOneOption` returns `Option` which maps cleanly to nullable

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ServiceMap.Service key format**
- **Found during:** Task 1
- **Issue:** Service key `"xbe/historyImport/Services/CodexRolloutParser"` was missing the class name suffix, violating the project's `deterministicKeys` TypeScript diagnostic rule
- **Fix:** Changed key to `"xbe/historyImport/Services/CodexRolloutParser/CodexRolloutParserService"` following existing convention from CodexHistoryScannerService
- **Files modified:** `apps/server/src/historyImport/Services/CodexRolloutParser.ts`
- **Verification:** `bun typecheck` passes without deterministicKeys warning
- **Committed in:** 151b00f3 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed FileSystem context leaking into parse return type**
- **Found during:** Task 1
- **Issue:** Plan's suggested `streamLines` function accessed `FileSystem.FileSystem` inside the parse call, causing the `FileSystem` requirement to appear in the `Effect.Effect` return type, violating the service shape (which expects `never` context)
- **Fix:** Moved `FileSystem.FileSystem` acquisition to layer construction time (`makeCodexRolloutParser` generator) and captured `fs` in closure
- **Files modified:** `apps/server/src/historyImport/Layers/CodexRolloutParser.ts`
- **Verification:** `bun typecheck` passes, parse method correctly returns `Effect<..., never>`
- **Committed in:** 151b00f3 (Task 1 commit)

**3. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes incompatibility in function signatures**
- **Found during:** Task 1
- **Issue:** `handleCompaction` and `processEventMsg` used explicit optional property types in parameters (`replacement_history?: ...`, `message?: string`) that conflicted with `exactOptionalPropertyTypes: true` -- Schema-decoded types use `readonly` properties with `| undefined` appended by the Schema decoder
- **Fix:** Changed `handleCompaction` to accept separate `message` and `replacementHistory` parameters instead of an object. Changed `processEventMsg` to accept `typeof CodexEventMsg.Type` directly.
- **Files modified:** `apps/server/src/historyImport/Layers/CodexRolloutParser.ts`
- **Verification:** `bun typecheck` passes with no type errors
- **Committed in:** 151b00f3 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 bug fixes)
**Impact on plan:** All fixes were necessary for correct compilation. No scope creep.

## Issues Encountered
- Effect v4 `Stream.mapAccum` expects `LazyArg<S>` (factory function) for initial state, not a direct value -- used `Stream.runFold` instead for simpler accumulation
- Effect v4 `ServiceMap.Service` requires `()("key")` call pattern (double invocation) which was initially missed
- `exactOptionalPropertyTypes: true` in tsconfig makes Schema-decoded optional properties (`x?: string`) incompatible with manually typed optional parameters -- resolved by using Schema types directly

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CodexRolloutParser ready for Plan 03 materializer (parsing rollout files into orchestration commands)
- HistoryImportService.execute stub ready to be implemented in Plan 03
- list() and preview() functional and ready for WS method wiring in Plan 03
- All code compiles and lints cleanly

## Self-Check: PASSED

All created files verified present. All task commit hashes verified in git log.

---
*Phase: 02-codex-import-pipeline*
*Completed: 2026-03-12*
