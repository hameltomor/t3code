---
phase: 07-schema-foundation-and-context-window-registry
plan: 01
subsystem: contracts
tags: [effect-schema, token-usage, context-window, event-sourcing, orchestration]

# Dependency graph
requires: []
provides:
  - NormalizedTokenUsage schema for canonical token usage across providers
  - ContextStatusSupport, ContextStatusSource, ContextStatusFreshness, ContextStatusLevel enums
  - OrchestrationThreadContextStatus schema with compaction history and measuredAt
  - contextStatus field on OrchestrationThread with null default
  - ThreadContextStatusSetCommand in InternalOrchestrationCommand union
  - ThreadContextStatusSetPayload for event payloads
  - thread.context-status-set event in OrchestrationEvent and OrchestrationPersistedEvent
affects: [07-02, 08, 09, 10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NullOr + withDecodingDefault(null) for backward-compatible nullable schema fields"
    - "Internal command + event pair pattern for server-only state mutations"

key-files:
  created: []
  modified:
    - packages/contracts/src/orchestration.ts

key-decisions:
  - "contextStatus uses NullOr + withDecodingDefault(null) for backward compat with existing persisted data"
  - "Command uses dot-separated type (thread.context-status.set), event uses dash-separated (thread.context-status-set) following existing convention"
  - "ThreadContextStatusSetCommand is not exported (internal-only), ThreadContextStatusSetPayload is exported"

patterns-established:
  - "NullOr + withDecodingDefault(null) pattern: used for adding nullable fields to existing aggregate schemas without breaking deserialization of previously persisted data"

# Metrics
duration: 6min
completed: 2026-03-13
---

# Phase 7 Plan 1: Schema Foundation Summary

**NormalizedTokenUsage, context status enums, OrchestrationThreadContextStatus schema, and thread.context-status.set command/event wiring in contracts package**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-13T16:54:16Z
- **Completed:** 2026-03-13T17:00:38Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Defined NormalizedTokenUsage schema with required totalTokens and optional provider-specific fields (inputTokens, outputTokens, cachedInputTokens, reasoningTokens)
- Defined four context status enum schemas (ContextStatusSupport, ContextStatusSource, ContextStatusFreshness, ContextStatusLevel) covering SDM-03 through SDM-06
- Defined OrchestrationThreadContextStatus schema with provider info, support level, token usage, compaction history, and measuredAt timestamp
- Added contextStatus field to OrchestrationThread with NullOr + withDecodingDefault(null) for backward compatibility
- Wired thread.context-status.set command into InternalOrchestrationCommand and thread.context-status-set event into both OrchestrationEvent and OrchestrationPersistedEvent unions
- Added "thread.context-status-set" to OrchestrationEventType literals

## Task Commits

Each task was committed atomically:

1. **Task 1: Define NormalizedTokenUsage and OrchestrationThreadContextStatus schemas** - `b546f682` (feat)
2. **Task 2: Define thread.context-status.set command and event wiring** - `d1099b11` (feat)

## Files Created/Modified
- `packages/contracts/src/orchestration.ts` - All new schemas, enums, command, event types, and contextStatus field on OrchestrationThread
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` - Added contextStatus: null to thread construction
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts` - Added contextStatus: null to expected thread assertion
- `apps/server/src/orchestration/commandInvariants.test.ts` - Added contextStatus: null to test fixture threads
- `apps/server/src/checkpointing/Layers/CheckpointDiffQuery.test.ts` - Added contextStatus: null to test fixture thread
- `apps/web/src/components/ChatView.browser.tsx` - Added contextStatus: null to mock thread data
- `apps/web/src/store.test.ts` - Added contextStatus: null to makeReadModelThread helper

## Decisions Made
- Used NullOr + withDecodingDefault(null) for contextStatus on OrchestrationThread, following the same pattern as providerThreadId and worktreeEntries for backward compatibility with existing persisted data
- ThreadContextStatusSetCommand is not exported (internal command only) while ThreadContextStatusSetPayload is exported (needed by downstream event handlers)
- Followed existing naming convention: dot-separated for command type (thread.context-status.set), dash-separated for event type (thread.context-status-set)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added contextStatus: null to all existing OrchestrationThread object literals**
- **Found during:** Task 1 (schema definition)
- **Issue:** Adding contextStatus to OrchestrationThread with NullOr + withDecodingDefault makes it required in the output Type (Schema.decode handles the default, but TS object literals need the field explicitly). 6 files across server and web had thread object literals missing the new field.
- **Fix:** Added `contextStatus: null` to all thread object literals in test fixtures (4 files), mock data (1 file), and projection query construction (1 file)
- **Files modified:** apps/server/src/checkpointing/Layers/CheckpointDiffQuery.test.ts, apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts, apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts, apps/server/src/orchestration/commandInvariants.test.ts, apps/web/src/components/ChatView.browser.tsx, apps/web/src/store.test.ts
- **Verification:** Full workspace typecheck passes (all 7 packages)
- **Committed in:** b546f682 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for correctness -- adding a field to a shared schema requires updating all direct object constructions. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All schemas from SDM-01 through SDM-08 are defined and typed in contracts
- thread.context-status.set command and thread.context-status-set event are wired into contracts
- Expected decider.ts exhaustive-switch TS error exists for the new command type -- Plan 07-02 will add the decider case and projector handler
- Contracts package typechecks cleanly; workspace typecheck has exactly one expected error in decider.ts

---
*Phase: 07-schema-foundation-and-context-window-registry*
*Completed: 2026-03-13*
