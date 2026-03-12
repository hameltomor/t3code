---
phase: 02-codex-import-pipeline
verified: 2026-03-12T09:55:19Z
status: passed
score: 24/24 must-haves verified
re_verification: false
---

# Phase 02: Codex Import Pipeline Verification Report

**Phase Goal:** Users can discover, preview, and import Codex CLI conversations into XBE threads through the server API (no UI yet -- testable via WS calls)
**Verified:** 2026-03-12T09:55:19Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Plan 01 must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Codex JSONL rollout line types are schema-validated with tolerance for unknown fields | VERIFIED | `CodexRolloutSchemas.ts:11` — `{ parseOptions: { onExcessProperty: "ignore" } }` annotated on all structs |
| 2 | OrchestrationEngine can dispatch thread.message.import commands producing thread.message-sent events without triggering provider lifecycle | VERIFIED | `decider.ts:620-641` — case produces `thread.message-sent`, no `thread.turn-start-requested` emitted |
| 3 | OrchestrationEngine can dispatch thread.activity.import commands producing thread.activity-appended events without triggering provider lifecycle | VERIFIED | `decider.ts:643-658` — case produces `thread.activity-appended`, no provider lifecycle side effects |
| 4 | thread.create command passes providerThreadId through to the thread.created event payload | VERIFIED | `decider.ts:169` — `providerThreadId: command.providerThreadId ?? null` present in payload |
| 5 | CodexHistoryScanner can query state_5.sqlite read-only for sessions matching a workspace root | VERIFIED | `Layers/CodexHistoryScanner.ts:197-224` — scoped read-only SQL layer, PRAGMA busy_timeout=5000, filtered WHERE clause |
| 6 | CodexHistoryScanner populates the history_import_catalog table with discovered sessions | VERIFIED | `Layers/CodexHistoryScanner.ts:283-293` — `catalogRepo.upsert(entry)` called for each valid session |
| 7 | SubAgent sessions and archived sessions are excluded from scan results | VERIFIED | `Layers/CodexHistoryScanner.ts:205-208` — SQL `AND source IN ('cli', 'vscode') AND agent_nickname IS NULL AND archived = 0` |
| 8 | Rollout file fingerprints are computed using session ID, file size, mtime, and head/tail SHA-256 | VERIFIED | `Layers/CodexHistoryScanner.ts:46-85` — `computeFingerprint` hashes sessionId + fileSize + mtimeMs + headBuf + tailBuf |

### Observable Truths (Plan 02 must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 9 | Calling historyImport.list with a workspace root returns catalog entries for that workspace | VERIFIED | `wsServer.ts:1090-1098` — routes to `historyImportService.list(body)`; layer calls `catalogRepo.listByWorkspace` |
| 10 | Calling historyImport.preview with a catalogId returns a message/activity sample with total counts | VERIFIED | `Layers/HistoryImportService.ts:87-138` — catalog lookup → parser.parse with caps → HistoryImportConversationPreview with `totalMessageCount`, `totalActivityCount`, `isTruncated` |
| 11 | Preview response includes warnings about compacted or encrypted content | VERIFIED | `Layers/CodexRolloutParser.ts:218` — compaction warning; `Layers/CodexRolloutParser.ts:135-136` — encrypted reasoning warning; both included in `parseResult.warnings` propagated to preview |
| 12 | Codex JSONL rollout files are streamed line-by-line without loading the full file into memory | VERIFIED | `Layers/CodexRolloutParser.ts:466-471` — `fs.stream(filePath, { chunkSize: FileSystem.KiB(64) })` piped through `Stream.decodeText` → `Stream.splitLines` |
| 13 | Context compaction events reset accumulated messages and use replacement_history when available | VERIFIED | `Layers/CodexRolloutParser.ts:189-219` — `handleCompaction` clears `state.messages = []` and `state.activities = []`, processes `replacementHistory` items, or creates synthetic system message |
| 14 | Encrypted reasoning content is skipped entirely, only reasoning summary is retained | VERIFIED | `Layers/CodexRolloutParser.ts:132-136` — `if (item.encrypted_content)` → `state.warnings.push("Skipped encrypted reasoning"); return;` |
| 15 | Streaming/incomplete messages from interrupted sessions are force-completed | VERIFIED | `Layers/CodexRolloutParser.ts:442-451` — `postProcess` sets last assistant message `isStreaming: false` |
| 16 | Preview returns a capped message sample (default 50) and activity sample without full file load | VERIFIED | `Layers/HistoryImportService.ts:89` — `maxMessages = input.maxMessages ?? 50`; parser receives `maxMessages` and `maxActivities: 20` caps |

### Observable Truths (Plan 03 must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 17 | historyImport.execute creates a normal XBE thread with imported messages projected through OrchestrationEngine.dispatch | VERIFIED | `Layers/HistoryMaterializer.ts:65-78` — `engine.dispatch({ type: "thread.create", ... })` |
| 18 | All imported messages use thread.message.import command, not thread.turn.start (no provider lifecycle triggered) | VERIFIED | `Layers/HistoryMaterializer.ts:84-96` — dispatches `thread.message.import` in for-loop, no `thread.turn.start` call anywhere |
| 19 | All imported activities use thread.activity.import command | VERIFIED | `Layers/HistoryMaterializer.ts:100-118` — dispatches `thread.activity.import` in for-loop |
| 20 | Re-importing the same Codex session is rejected with a reference to the existing thread (dedup via providerThreadId) | VERIFIED | `Layers/HistoryMaterializer.ts:50-59` — `readModel.threads.find(t => t.providerThreadId === input.providerThreadId && !t.deletedAt)` → fails with `HistoryImportMaterializeError` including `existingThreadId` |
| 21 | ThreadExternalLink row is persisted after successful import with correct fingerprint, link mode, and source metadata | VERIFIED | `Layers/HistoryMaterializer.ts:121-146` — `externalLinkRepo.upsert({...sourceFingerprint, linkMode, sourcePath, originalWorkspaceRoot, ...})` |
| 22 | historyImport.list WS method returns real scan results instead of not-implemented error | VERIFIED | `wsServer.ts:1090-1098` — delegates to `historyImportService.list(body)` |
| 23 | historyImport.preview WS method returns real preview instead of not-implemented error | VERIFIED | `wsServer.ts:1099-1107` — delegates to `historyImportService.preview(body)` |
| 24 | historyImport.execute WS method creates thread and returns import result | VERIFIED | `wsServer.ts:1108-1116` — delegates to `historyImportService.execute(body)` |

**Score:** 24/24 truths verified

---

## Required Artifacts

| Artifact | Status | Level 1 (Exists) | Level 2 (Substantive) | Level 3 (Wired) |
|----------|--------|------------------|-----------------------|-----------------|
| `apps/server/src/historyImport/Schemas/CodexRolloutSchemas.ts` | VERIFIED | Yes | 121 lines, exports CodexRolloutLine, CodexSessionMetaLine, CodexSessionMeta, etc. | Imported by CodexRolloutParser layer |
| `apps/server/src/historyImport/Errors.ts` | VERIFIED | Yes | 4 tagged error classes: ScanError, ParseError, MaterializeError, NotFoundError | Imported across all historyImport layers |
| `apps/server/src/historyImport/Services/CodexHistoryScanner.ts` | VERIFIED | Yes | CodexHistoryScannerService with scan() shape | Used by CodexHistoryScanner layer and HistoryImportService layer |
| `apps/server/src/historyImport/Layers/CodexHistoryScanner.ts` | VERIFIED | Yes | Full SQLite scan + fingerprint + catalog upsert implementation | Exported as CodexHistoryScannerLive, composed in serverLayers.ts |
| `apps/server/src/historyImport/Services/CodexRolloutParser.ts` | VERIFIED | Yes | CodexRolloutParserService + ParsedCodexMessage/Activity/CodexRolloutParseResult types | Used by CodexRolloutParser layer and HistoryImportService layer |
| `apps/server/src/historyImport/Layers/CodexRolloutParser.ts` | VERIFIED | Yes | Full streaming JSONL parser with compaction, encryption skip, post-processing | Exported as CodexRolloutParserLive, composed in serverLayers.ts |
| `apps/server/src/historyImport/Services/HistoryImportService.ts` | VERIFIED | Yes | HistoryImportServiceService with list/preview/execute shape | Used by HistoryImportService layer; yielded in wsServer.ts |
| `apps/server/src/historyImport/Layers/HistoryImportService.ts` | VERIFIED | Yes | Full list + preview + execute implementation (no stubs) | Exported as HistoryImportServiceLive, composed in serverLayers.ts |
| `apps/server/src/historyImport/Services/HistoryMaterializer.ts` | VERIFIED | Yes | HistoryMaterializerService with materialize() shape and MaterializeInput type | Used by HistoryMaterializer layer and HistoryImportService layer |
| `apps/server/src/historyImport/Layers/HistoryMaterializer.ts` | VERIFIED | Yes | Full dedup + thread.create + sequential dispatch + ThreadExternalLink persistence | Exported as HistoryMaterializerLive, composed in serverLayers.ts |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/contracts/src/orchestration.ts` | `apps/server/src/orchestration/decider.ts` | thread.message.import handled by decider | WIRED | `orchestration.ts:590-600` defines schema; `decider.ts:620-641` handles case |
| `packages/contracts/src/orchestration.ts` | `apps/server/src/orchestration/decider.ts` | thread.activity.import handled by decider | WIRED | `orchestration.ts:602-608` defines schema; `decider.ts:643-658` handles case |
| `apps/server/src/historyImport/Layers/CodexHistoryScanner.ts` | `apps/server/src/persistence/Services/HistoryImportCatalog.ts` | upserts scan results to catalog repository | WIRED | `CodexHistoryScanner.ts:19` imports HistoryImportCatalogRepository; `line:283` calls `catalogRepo.upsert(entry)` |
| `apps/server/src/historyImport/Layers/CodexRolloutParser.ts` | `apps/server/src/historyImport/Schemas/CodexRolloutSchemas.ts` | imports Codex JSONL schemas for line parsing | WIRED | `CodexRolloutParser.ts:13-22` imports CodexRolloutLine, CodexSessionMetaLine, CodexResponseItem, etc. |
| `apps/server/src/historyImport/Layers/HistoryImportService.ts` | `apps/server/src/historyImport/Layers/CodexRolloutParser.ts` | calls parser for preview | WIRED | `HistoryImportService.ts:28` imports CodexRolloutParserService; yielded at line:42; used at lines:111,162 |
| `apps/server/src/historyImport/Layers/HistoryImportService.ts` | `apps/server/src/persistence/Services/HistoryImportCatalog.ts` | reads catalog for list method, looks up entry by catalogId for preview | WIRED | `HistoryImportService.ts:19` imports HistoryImportCatalogRepository; used at lines:65,92,143 |
| `apps/server/src/historyImport/Layers/HistoryMaterializer.ts` | `apps/server/src/orchestration/Services/OrchestrationEngine.ts` | dispatches thread.create, thread.message.import, thread.activity.import commands | WIRED | `HistoryMaterializer.ts:26` imports OrchestrationEngineService; dispatches at lines:65,84-96,102-118 |
| `apps/server/src/historyImport/Layers/HistoryMaterializer.ts` | `apps/server/src/persistence/Services/ThreadExternalLinks.ts` | persists ThreadExternalLink row after import | WIRED | `HistoryMaterializer.ts:30` imports ThreadExternalLinkRepository; upsert called at line:121 |
| `apps/server/src/wsServer.ts` | `apps/server/src/historyImport/Services/HistoryImportService.ts` | WS method handlers call HistoryImportService methods | WIRED | `wsServer.ts:81` imports; `line:643` yields service; `lines:1090-1116` delegates list/preview/execute |
| `apps/server/src/historyImport/Layers/HistoryImportService.ts` | `apps/server/src/historyImport/Layers/HistoryMaterializer.ts` | execute method delegates to materializer | WIRED | `HistoryImportService.ts:32` imports HistoryMaterializerService; yielded at line:44; used at line:165 |

---

## Build and Typecheck

| Check | Status | Notes |
|-------|--------|-------|
| `bun typecheck` | PASSED | All 7 packages compiled successfully (12.6s); TS41 messages are style suggestions not errors |
| `bun lint` | PASSED | 0 errors, 9 warnings (all pre-existing, none in historyImport code) |
| All 6 commit hashes verified | PASSED | 14bc4731, 1d5b1274, 151b00f3, d31b27c4, 4362ef33, af8e9309 all present in git log |

---

## Anti-Patterns Scan

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `Layers/HistoryImportService.ts` | Comment: "Stub in this plan" in service interface file | INFO | Comment in interface file (Services/), not the layer. Layer has full implementation. No actual stub. |
| `Layers/HistoryMaterializer.ts:39` | `return null` | INFO | Legitimate early-exit for null turnId input — not a placeholder |
| `Layers/CodexHistoryScanner.ts:190` | `return []` | INFO | Legitimate early-exit when `state_5.sqlite` absent — correct behavior per NFR-4 |

No blockers or warnings found.

---

## Requirements Coverage

Phase goal: "Users can discover, preview, and import Codex CLI conversations into XBE threads through the server API (testable via WS calls)"

| Capability | WS Method | Status | Supporting Truth |
|-----------|-----------|--------|-----------------|
| Discover (scan + list) | `historyImport.list` | SATISFIED | Truth #22 — functional, triggers scan, returns catalog |
| Preview (parse + sample) | `historyImport.preview` | SATISFIED | Truth #23 — functional, returns capped messages/activities with warnings |
| Import (materialize + persist) | `historyImport.execute` | SATISFIED | Truth #24 — functional, creates thread via orchestration, persists external link |
| List thread links | `historyImport.listThreadLinks` | SATISFIED | `wsServer.ts:1122-1129` — delegates to `externalLinkRepo.listByThreadId` |
| Validate link | `historyImport.validateLink` | DEFERRED | Deliberately stub per Phase 5 plan — known and intentional |
| No provider lifecycle on import | Architecture constraint | SATISFIED | Truth #18 — thread.message.import not thread.turn.start |
| Deduplication | Architecture constraint | SATISFIED | Truth #20 — providerThreadId dedup via read model |

---

## Human Verification Required

### 1. End-to-End WS Test with Real Codex Installation

**Test:** From a machine with Codex installed and sessions in `~/.codex/state_5.sqlite`, connect to the WS server and send `historyImport.list` with a real workspace root.
**Expected:** Returns an array of catalog entries (not empty if Codex sessions exist for that workspace). Then call `historyImport.preview` with a returned `catalogId` and verify messages/activities match the actual session. Finally call `historyImport.execute` and confirm a new thread appears in `orchestration.getSnapshot`.
**Why human:** Requires real Codex CLI sessions on disk. Integration test cannot be run programmatically in this context.

### 2. Deduplication Behavior Under WS

**Test:** Call `historyImport.execute` for the same `catalogId` twice.
**Expected:** Second call returns an error response with a message referencing the existing thread ID, not a second import.
**Why human:** Requires live WS session and a real catalog entry from a prior scan.

### 3. Compaction Warning Propagation to Preview

**Test:** Run `historyImport.preview` on a Codex rollout file that contains a `"compacted"` line.
**Expected:** `warnings` array in the response contains `"Context compaction detected -- pre-compaction messages discarded"`.
**Why human:** Requires a Codex session with actual compaction in the rollout file.

---

## Summary

Phase 02 goal is fully achieved. All 24 observable truths are verified across the three plans:

**Plan 01 (Schemas and Scanner):** All Codex JSONL schemas exist with tolerant parsing. Two new import-specific orchestration commands (`thread.message.import`, `thread.activity.import`) are wired through the contracts into the decider, producing correct event types without provider lifecycle side effects. `thread.create` correctly passes `providerThreadId`. `CodexHistoryScanner` queries state_5.sqlite read-only, filters out sub-agents and archived sessions, computes SHA-256 fingerprints, and upserts catalog entries.

**Plan 02 (Streaming Parser and Import Service):** `CodexRolloutParser` streams JSONL line-by-line via Effect FileSystem (never loads full file), handles compaction resets (discards pre-compaction messages, processes replacement_history), skips encrypted reasoning with warnings, and force-completes streaming messages in post-processing. `HistoryImportService.list` and `.preview` are functional with scan failure isolation (NFR-4) and message caps (default 50).

**Plan 03 (Materializer and WS Wiring):** `HistoryMaterializer` creates XBE threads via sequential orchestration dispatch using import commands (no provider lifecycle), checks providerThreadId for dedup, and persists `ThreadExternalLink`. All WS method handlers replaced with real implementations. All history import layers composed and merged into `serverLayers.ts`. `bun typecheck` and `bun lint` pass cleanly.

---

_Verified: 2026-03-12T09:55:19Z_
_Verifier: Claude (gsd-verifier)_
