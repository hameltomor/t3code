---
phase: 09-server-pipeline-and-persistence
verified: 2026-03-13T18:48:40Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 9: Server Pipeline and Persistence Verification Report

**Phase Goal:** Token usage events flow through the full server pipeline -- ingestion, projection, persistence, snapshot hydration -- so context status is available on every OrchestrationThread pushed to clients
**Verified:** 2026-03-13T18:48:40Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                                          | Status     | Evidence                                                                                                                       |
|----|------------------------------------------------------------------------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------------------------------------------------------------|
| 1  | `projection_thread_context_status` table is created by migration 020 with threadId primary key and all OrchestrationThreadContextStatus fields | VERIFIED  | `020_ProjectionThreadContextStatus.ts` creates table with all 15 columns; registered as `"20_ProjectionThreadContextStatus"` in `Migrations.ts` |
| 2  | `ProjectionThreadContextStatusRepository` upserts and reads context status rows following the same Service+Layer pattern                       | VERIFIED  | Service exports `ProjectionThreadContextStatus`, `ProjectionThreadContextStatusRepository`; Layer exports `ProjectionThreadContextStatusRepositoryLive` with full upsert/getByThreadId/deleteByThreadId |
| 3  | The projection pipeline persists context status on every `thread.context-status-set` event via a supplementary projector                      | VERIFIED  | `applyThreadContextStatusProjection` defined and registered in `projectors` array; calls `projectionThreadContextStatusRepository.upsert`; NOT in `REQUIRED_SNAPSHOT_PROJECTORS` |
| 4  | The in-memory projector updates `OrchestrationThread.contextStatus` on `thread.context-status-set` events                                     | VERIFIED  | `projector.ts` case `"thread.context-status-set"` decodes `ThreadContextStatusSetPayload` and calls `updateThread` with `{ contextStatus: payload.contextStatus }` |
| 5  | `computeContextStatus` pure function converts `NormalizedTokenUsage` + model info into `OrchestrationThreadContextStatus` with correct status levels | VERIFIED  | `contextStatusComputation.ts` exports `computeContextStatus`; returns ok/watch/near-limit/compacted/unknown based on percent thresholds; uses `getContextWindowLimit` from `@xbetools/shared/model` |
| 6  | `ProviderRuntimeIngestion` handles `thread.token-usage.updated` events and dispatches `thread.context-status.set` commands                   | VERIFIED  | Handler at line 1124 processes `thread.token-usage.updated`, calls `computeContextStatus`, dispatches `thread.context-status.set`; failures caught with `Effect.catch` |
| 7  | Ingestion-side throttle prevents excessive dispatches (2-second interval AND totalTokens change detection)                                    | VERIFIED  | `lastContextStatusDispatch` Map at line 513; `shouldDispatchContextStatus` checks both time delta (2000ms) and totalTokens equality; `recordContextStatusDispatch` updates after each dispatch |
| 8  | `ProjectionSnapshotQuery` hydrates `thread.contextStatus` from `projection_thread_context_status` instead of hardcoded null                   | VERIFIED  | `listContextStatusRows` SQL query selects from `projection_thread_context_status`; loaded in `Effect.all` transaction; thread assembly uses `contextStatusByThread.get(row.threadId) ?? null` at line 643 |
| 9  | Integration tests verify the full flow: provider token event -> ingestion -> orchestration -> read model with `contextStatus` populated       | VERIFIED  | `ProviderRuntimeIngestion.test.ts` has "context status pipeline" describe block with two tests: pipeline dispatch test (asserts `contextStatus.status === "ok"`) and throttle dedup test |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact                                                                                    | Expected                                             | Status    | Details                                                                    |
|---------------------------------------------------------------------------------------------|------------------------------------------------------|-----------|----------------------------------------------------------------------------|
| `apps/server/src/persistence/Migrations/020_ProjectionThreadContextStatus.ts`              | SQLite migration for `projection_thread_context_status` table | VERIFIED | Creates table with `thread_id TEXT PRIMARY KEY` and 14 additional columns |
| `apps/server/src/persistence/Services/ProjectionThreadContextStatus.ts`                    | Repository service interface                         | VERIFIED  | Exports `ProjectionThreadContextStatus` schema and `ProjectionThreadContextStatusRepository` ServiceMap.Service |
| `apps/server/src/persistence/Layers/ProjectionThreadContextStatus.ts`                      | Repository layer implementation                      | VERIFIED  | Exports `ProjectionThreadContextStatusRepositoryLive`; full upsert with ON CONFLICT DO UPDATE; camelCase aliases in SELECT |
| `apps/server/src/provider/normalization/contextStatusComputation.ts`                       | Pure computation function                            | VERIFIED  | Exports `computeContextStatus`; correct thresholds: ok < 75%, watch >= 75%, near-limit >= 95%, compacted on 80% token drop |
| `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`                        | Token usage event handling with throttle             | VERIFIED  | Handles `thread.token-usage.updated`; per-thread Map throttle; dispatches `thread.context-status.set`; `Effect.catch` for graceful failure |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`                         | Snapshot hydration from projection table             | VERIFIED  | Queries `projection_thread_context_status`; builds `contextStatusByThread` Map; hydrates `contextStatus` field per thread |
| `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`                   | Integration tests for context status pipeline        | VERIFIED  | Two tests: dispatch test asserts `contextStatus` not null with correct fields; throttle test emits 5 identical events, verifies only 1 dispatched |

### Key Link Verification

| From                                | To                                               | Via                                                       | Status    | Details                                                     |
|-------------------------------------|--------------------------------------------------|-----------------------------------------------------------|-----------|-------------------------------------------------------------|
| `ProjectionPipeline.ts`             | `ProjectionThreadContextStatus.ts` (Layer)       | `projectionThreadContextStatusRepository.upsert()`        | WIRED     | Line 1186: `yield* projectionThreadContextStatusRepository.upsert({...})` inside `applyThreadContextStatusProjection` |
| `projector.ts`                      | `@xbetools/contracts ThreadContextStatusSetPayload` | `decodeForEvent` + `updateThread` with `contextStatus` patch | WIRED  | Case `"thread.context-status-set"` decodes payload and calls `updateThread(nextBase.threads, payload.threadId, { contextStatus: payload.contextStatus })` |
| `ProviderRuntimeIngestion.ts`       | `contextStatusComputation.ts`                    | `computeContextStatus` call in token usage handler        | WIRED     | Line 15-16: imports `computeContextStatus`; line 1131: called with provider, model, usage, support, source, measuredAt, previousStatus |
| `ProviderRuntimeIngestion.ts`       | `OrchestrationEngine.ts`                         | `orchestrationEngine.dispatch("thread.context-status.set")` | WIRED  | Line 1141-1148: dispatches command with `type: "thread.context-status.set"` wrapped in `Effect.catch` for failure isolation |
| `ProjectionSnapshotQuery.ts`        | `projection_thread_context_status` table         | SQL query in snapshot assembly                             | WIRED     | Line 342-364: `listContextStatusRows` queries table; result included in `Effect.all` at line 380; hydrated at line 584-609 |

### Requirements Coverage

Not applicable -- no REQUIREMENTS.md entries mapped specifically to phase 09.

### Anti-Patterns Found

None detected. No TODO/FIXME/placeholder comments in any phase 09 files. No empty implementations or return-null stubs.

### Human Verification Required

#### 1. Context Status in Live Reconnect

**Test:** Start a server session, emit token usage events, kill and restart the server, then reconnect.
**Expected:** Reconnecting client receives an `OrchestrationThread` with `contextStatus` already populated (hydrated from the snapshot query).
**Why human:** Server restart behavior and WebSocket reconnect flow cannot be verified statically.

#### 2. Throttle Timing Under Real Load

**Test:** Trigger rapid provider token events in a real Codex session (e.g. a long-running turn).
**Expected:** Context status updates appear in the UI at most once per 2 seconds, not on every token event.
**Why human:** Real timing behavior depends on actual event emission frequency from Codex, which can only be observed at runtime.

### Gaps Summary

No gaps. All 9 must-haves are verified at all three levels (exists, substantive, wired).

The phase achieved its goal: token usage events from provider adapters flow through ProviderRuntimeIngestion (with throttle/dedup) -> computeContextStatus -> orchestration dispatch -> in-memory projection (read model update) -> pipeline projection (DB persistence) -> snapshot hydration on restart. Every `OrchestrationThread` pushed to clients carries a populated `contextStatus` field after the first token usage event for that thread.

---

*Verified: 2026-03-13T18:48:40Z*
*Verifier: Claude (gsd-verifier)*
