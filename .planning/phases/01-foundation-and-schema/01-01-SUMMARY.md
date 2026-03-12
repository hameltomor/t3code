---
phase: 01-foundation-and-schema
plan: 01
subsystem: contracts
tags: [effect-schema, websocket, history-import, orchestration]

# Dependency graph
requires: []
provides:
  - History import contract schemas (enums, records, inputs, WS methods, push channels)
  - providerThreadId field on OrchestrationThread, ThreadCreateCommand, ThreadCreatedPayload
  - 5 WS method entries and tagged request bodies for historyImport.*
  - historyImport.catalogUpdated push channel
affects: [01-02, 02-codex-scanner, 03-server-endpoints, 04-claude-code-scanner, 05-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema.Literals enum pattern for new domain enums (HistoryImportProvider, LinkMode, ValidationStatus)"
    - "Schema.NullOr with withDecodingDefault(null) for backward-compatible optional fields"
    - "WS method constant objects + tagged request bodies for new RPC methods"

key-files:
  created:
    - packages/contracts/src/historyImport.ts
  modified:
    - packages/contracts/src/orchestration.ts
    - packages/contracts/src/ws.ts
    - packages/contracts/src/index.ts
    - apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
    - apps/server/src/wsServer.ts
    - apps/web/src/components/ChatView.tsx
    - apps/web/src/components/ChatView.browser.tsx
    - apps/web/src/store.test.ts

key-decisions:
  - "Used withDecodingDefault(() => null) on providerThreadId in all three orchestration schemas (OrchestrationThread, ThreadCreateCommand, ThreadCreatedPayload) for backward compatibility with existing data and code"
  - "Set providerThreadId to null in ProjectionSnapshotQuery since DB column does not exist yet (migration deferred to later plan)"

patterns-established:
  - "History import contract module follows existing draft.ts/notification.ts pattern: WS method constants, push channels, enums, record schemas, input schemas"
  - "New nullable fields on existing schemas use withDecodingDefault(() => null) to avoid breaking all existing call sites"

# Metrics
duration: 11min
completed: 2026-03-12
---

# Phase 1 Plan 01: Foundation Contract Schemas Summary

**History import contract schemas with 3 enums, 10 schema structs, WS method/channel constants, and providerThreadId on 3 orchestration types**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-12T08:01:21Z
- **Completed:** 2026-03-12T08:12:54Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments
- Created complete `historyImport.ts` contract module with all enums, record schemas, input schemas, WS method constants, and push channel
- Extended `OrchestrationThread`, `ThreadCreateCommand`, and `ThreadCreatedPayload` with `providerThreadId` field
- Wired 5 historyImport WS methods and tagged request bodies into `ws.ts`
- Added `historyImport.catalogUpdated` push channel to `WS_CHANNELS`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create historyImport.ts contract module and update index.ts** - `5d9616cc` (feat)
2. **Task 2: Add providerThreadId to OrchestrationThread schemas and wire WS methods** - `bbfacd07` (feat)

## Files Created/Modified
- `packages/contracts/src/historyImport.ts` - New module: 3 enums, 5 record schemas, 5 input schemas, WS method/channel constants
- `packages/contracts/src/orchestration.ts` - Added providerThreadId to OrchestrationThread, ThreadCreateCommand, ThreadCreatedPayload
- `packages/contracts/src/ws.ts` - Added 5 historyImport WS methods, tagged bodies, and catalogUpdated push channel
- `packages/contracts/src/index.ts` - Re-export of historyImport module
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` - Added providerThreadId: null to thread snapshot mapping
- `apps/server/src/wsServer.ts` - Added providerThreadId: null to bootstrap thread.create dispatch
- `apps/web/src/components/ChatView.tsx` - Added providerThreadId: null to two thread.create dispatches
- `apps/web/src/components/ChatView.browser.tsx` - Added providerThreadId: null to test thread object
- `apps/web/src/store.test.ts` - Added providerThreadId: null to test thread factory
- 8 server test files - Added providerThreadId: null to thread.create commands and thread/event payload objects

## Decisions Made
- Used `withDecodingDefault(() => null)` on providerThreadId in all three orchestration schemas for backward compatibility -- without this, every existing call site would need the field explicitly, and persisted events without the field would fail to decode
- Set providerThreadId to `null` in ProjectionSnapshotQuery since the DB migration adding the column does not exist yet

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added withDecodingDefault to OrchestrationThread.providerThreadId**
- **Found during:** Task 2
- **Issue:** Plan specified `providerThreadId: Schema.NullOr(TrimmedNonEmptyString)` on OrchestrationThread without a decoding default. This made the field required in the TypeScript output type, breaking all existing call sites that construct OrchestrationThread objects
- **Fix:** Added `.pipe(Schema.withDecodingDefault(() => null))` matching the pattern used on ThreadCreateCommand and ThreadCreatedPayload
- **Files modified:** packages/contracts/src/orchestration.ts
- **Verification:** `bun typecheck` passes for contracts package
- **Committed in:** bbfacd07

**2. [Rule 3 - Blocking] Fixed all existing call sites to include providerThreadId: null**
- **Found during:** Task 2
- **Issue:** Even with `withDecodingDefault`, TypeScript's output type still requires the field when constructing objects directly (not through Schema.decode). All existing `thread.create` dispatches, `OrchestrationThread` object literals, and `ThreadCreatedPayload` objects needed the field
- **Fix:** Added `providerThreadId: null` to all call sites across web app, server, and test files (16 files total)
- **Files modified:** 14 files across apps/server and apps/web
- **Verification:** `bun typecheck` passes for all packages except expected exhaustive switch error
- **Committed in:** bbfacd07

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were necessary for the codebase to compile. The providerThreadId field must be backward-compatible since it's being added to existing schemas. No scope creep.

## Issues Encountered
- The expected exhaustive switch error in `wsServer.ts` at line 1084 confirms the new WS method tags are registered but lack case handlers. This will be resolved in Plan 02.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All contract schemas are in place for history import feature
- Plan 02 can proceed to add DB migrations and server-side handlers for the new WS methods
- The exhaustive switch error in wsServer.ts serves as a compile-time reminder that handlers need to be added

## Self-Check: PASSED

- [x] packages/contracts/src/historyImport.ts exists
- [x] 01-01-SUMMARY.md exists
- [x] Commit 5d9616cc exists
- [x] Commit bbfacd07 exists

---
*Phase: 01-foundation-and-schema*
*Completed: 2026-03-12*
