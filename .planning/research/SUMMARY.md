# Project Research Summary

**Project:** Chat History Import — XBE Code
**Domain:** File-based JSONL/SQLite import, event-sourced CQRS, developer tool GUI
**Researched:** 2026-03-12
**Confidence:** HIGH

## Executive Summary

XBE Code is adding the first unified chat-history importer in the code-agent GUI space: pull conversations from Codex CLI, Claude Code, and Gemini CLI into XBE's existing event-sourced thread model so they appear, navigate, and resume like native sessions. No competitor offers import (Cursor, Copilot, Cody only export). The feature delivers genuine competitive differentiation, particularly native Codex resume via `thread/resume`, but requires careful engineering to handle three independently-evolving on-disk formats.

The entire recommended implementation stack is already present in the codebase. Effect-TS `FileSystem.stream` + `Stream.splitLines` handles JSONL streaming without external libraries; the existing `NodeSqliteClient` with `readonly: true` covers Codex's WAL SQLite; `node:crypto` SHA-256 handles fingerprinting; and the existing `OrchestrationEngine.dispatch` pipeline is the only sanctioned ingestion path. One new dependency is justified: `tinyglobby` for pattern-based Codex session discovery under `~/.codex/sessions/YYYY/MM/DD/`. Everything else reuses existing infrastructure.

The critical risks cluster around three themes: (1) memory safety — Claude Code JSONL files reach 70 MB and must be streamed, never buffered; (2) format instability — all three providers have already undergone breaking format changes (Codex `.json`→`.jsonl`, Claude Code `sessions-index.json` addition, Gemini hash-to-slug migration) and will change again; (3) data integrity at import time — Codex context-compaction events, encrypted reasoning fields, truncated last lines from concurrent writes, and subagent session files can silently corrupt an import if not handled explicitly. These are not hypothetical — they are documented facts about the current provider behavior.

---

## Key Findings

### Recommended Stack

The implementation requires zero new core dependencies except `tinyglobby` for Codex session glob scanning. All critical pieces — Effect streaming, SQLite read-only access, SHA-256 fingerprinting, the orchestration command pipeline — are either built into Node.js 24 or already wired in the codebase.

**Core technologies:**

- `FileSystem.stream` + `Stream.splitLines` + `JSON.parse` per line — JSONL streaming for Claude Code and Codex files; handles 70 MB within a 64 KB heap budget per chunk; back-pressured by default
- `NodeSqliteClient.layer({ readonly: true })` + `PRAGMA busy_timeout = 5000` — read-only Codex SQLite with WAL-safe concurrent-read semantics; the `readonly` flag is already wired in the existing `NodeSqliteClient`
- `tinyglobby` (new dep, 179 KB) — pattern-based discovery of Codex `~/.codex/sessions/YYYY/MM/DD/*.jsonl`; replaces `fast-glob` as community standard for new projects
- `crypto.createHash("sha256")` on head + tail 4 KB sample — composite fingerprint for deduplication and staleness detection without full-file hashing (full-file hashing of 50+ large sessions per scan would be unacceptably slow)
- `Schema.decodeUnknownEither` per-line — tolerates unknown fields from evolving provider schemas without hard failures
- `effect/unstable/encoding/Ndjson` — already used for the WS RPC layer; do NOT use for file-based JSONL parsing (wrong abstraction; `Stream.splitLines` is simpler)
- `OrchestrationEngine.dispatch` — the only ingestion path; never write directly to projection tables

**Version constraint:** The monorepo pins `effect` to the private preview build `pkg.pr.new/Effect-TS/effect-smol/effect@8881a9b` (effect v4 pre-release). Module paths differ from stable v3 — use `effect/FileSystem`, not `@effect/platform/FileSystem`. All new code must use v4 paths.

### Expected Features

Research is unanimous that no competitor offers import. XBE is building on an uncontested surface. The dependency chain is strict: schema changes in `packages/contracts` must land before any server or UI work.

**Must have (table stakes — v1):**

- `providerThreadId` schema extension on `OrchestrationThread` / `ThreadCreateCommand` / `ThreadCreatedPayload` — gating prerequisite for everything else; deduplication and native resume both require this field
- Codex history reader (`~/.codex/sessions/` JSONL + `state_5.sqlite`) — primary provider for XBE Code users
- Workspace-path-scoped discovery — filter sessions by `workingDirectory` matching the XBE project `workspaceRoot`; mandatory UX affordance (users have hundreds of unrelated sessions)
- `import.discover` WS method — returns discovered sessions with `alreadyImported: bool` flag
- Preview + selective import UI — checkbox list with title, date, message count, already-imported badge
- Import execution (thread.create + message rehydration through `OrchestrationEngine`)
- Deduplication check — `(providerKind, providerThreadId)` index; return existing thread ID rather than creating a duplicate
- Per-thread error isolation and import progress feedback

**Should have (competitive differentiators — v1.x):**

- Claude Code reader (`~/.claude/projects/<cwd>/*.jsonl`)
- Native Codex resume via stored `providerThreadId` passed to `thread/resume` JSON-RPC — no other tool does this
- Auto-discovery badge on project open — "N conversations found in Codex history — import?"
- Import summary notification using existing notification system

**Defer (v2+):**

- Gemini CLI reader — auto-save is a requested but not stably shipped feature as of March 2026; wait for format stabilization
- Native resume for Claude Code — different protocol from Codex `thread/resume`; needs separate investigation
- Message-level activity import (tool call events, not just user/assistant pairs)
- Background re-import / live sync — high complexity, low value; explicitly an anti-feature

### Architecture Approach

The architecture is a new `historyImport/` domain under `apps/server/src/` that follows the existing `Services/` (interface) / `Layers/` (implementation) split observed throughout the codebase. Two new SQLite tables are added to the existing XBE database: `history_import_catalog` (discovery cache — staging area for scan results) and `thread_external_links` (durable resume metadata per imported thread). The separation between scan and import phases is non-negotiable: scanning populates the catalog, importing reads from the catalog and dispatches through the orchestration engine. These two phases never happen in the same transaction.

**Major components:**

1. `HistoryImportService` — orchestrator; exposes `listCatalog`, `preview`, `execute`, `validateThreadLink`; routes from `wsServer.ts`
2. `ProviderHistoryScanner` — fanout coordinator; fans out to per-provider scanners using `Effect.allSettled` (one scanner failure must not block others); normalizes results to `HistoryImportConversationSummary`
3. `ClaudeHistoryScanner` / `CodexHistoryScanner` / `GeminiHistoryScanner` — provider-specific file readers (read-only); each wraps a `parseXxx.ts` pure helper
4. `materializeImportedThread.ts` — dispatches `thread.create` + N `thread.message-sent` + M `thread.activity-appended` commands through the existing `OrchestrationEngine`
5. `HistoryImportCatalogRepository` + `ThreadExternalLinkRepository` — SQLite CRUD for the two new tables; scoped Effect layers
6. `ImportConversationsDialog` (web) — 5-step UX: provider/scope selection → thread list → preview → options → result
7. `ThreadImportProvenanceCard` (web) — origin badge, validation status, continue/validate actions on the thread view

### Critical Pitfalls

**Top 5 (must address before shipping v1):**

1. **70 MB JSONL files loaded into memory (CRITICAL)** — Never use `fs.readFile` or `readFileString` on provider JSONL files. Always stream with `FileSystem.stream` + `Stream.splitLines`. For catalog scans, stop parsing after extracting metadata (sessionId, timestamps, message count). For preview/import, stream and dispatch line-by-line. Violation causes OOM on multi-session imports.

2. **Codex context compaction corrupts message history (HIGH)** — Compaction events mark all preceding events as replaced. A naive sequential scan will double-import: both the original messages and the compaction summary. When a compaction event is detected, discard all previously accumulated messages and restart from the compaction summary. This interacts with the streaming constraint (Pitfall 1): must track compaction state while streaming, not after full load.

3. **Duplicate imports create ghost threads and list noise (HIGH)** — Without `(providerKind, providerThreadId)` deduplication, users clicking import twice get two identical threads. Partial import failures leave zero-message ghost threads. Solution: index `providerThreadId` in `projection_threads`; check before dispatching `thread.create`; track `importStatus` in the catalog (`pending` → `in-progress` → `complete` / `failed-partial`); surface partial imports with a warning badge rather than deleting.

4. **Provider format versioning breaks silently (HIGH)** — All three providers have already changed their formats without notice. Codex has two coexisting rollout formats (`.json` and `.jsonl`). Claude Code may or may not have `sessions-index.json`. Gemini has hash-based and slug-based project directories simultaneously. Mitigation: use `Schema.decodeUnknownEither` everywhere; detect format by file extension; scan both Gemini directory styles; fall back when index files are absent; store `detectedFormatVersion` in the catalog.

5. **Claude Code path encoding is lossy and causes cross-project contamination (HIGH)** — The `~/.claude/projects/<encoded-path>/` encoding replaces all `/` with `-`, creating collisions (`/home/user/projects/foo` and `/home/user/projects-foo` both encode to `projects-foo`). Never attempt to decode the directory name back to a path. Encode the current workspace path forward using the same algorithm and match exactly. Store the raw encoded directory name (not the decoded path) in the catalog.

**Additional high-severity pitfalls (must address):**

6. **File locking with active CLI sessions (HIGH)** — Codex SQLite with WAL mode: open read-only, set `PRAGMA busy_timeout = 5000`, retry on `SQLITE_BUSY`. JSONL concurrent writes: treat a truncated last line as a recoverable skip, not a hard failure.

7. **Subagent sessions flood the thread list (MEDIUM)** — Codex and Claude Code spawn subagent sessions stored alongside main sessions. Filter by `parentSessionId` field; apply heuristics (message count < 5, duration < 60s, no direct user messages) for older formats that omit the field. Default to excluding subagent sessions.

8. **Streaming/incomplete messages from interrupted sessions (MEDIUM)** — A session killed mid-stream leaves a delta event with no corresponding complete event. The XBE projector will show the last message with `streaming: true` indefinitely, blocking "Continue". Force-complete all messages at parse finalization before dispatching.

---

## Implications for Roadmap

### Phase 1: Foundation and Schema
**Rationale:** Everything gates on this. `providerThreadId` on the thread schema is a prerequisite for deduplication, native resume, and the import WS API. DB migrations must precede repositories. Contracts must precede server implementation. No code can be written against unstable types.
**Delivers:** Updated `packages/contracts` with `historyImport.ts` schema file; `providerThreadId` added to `OrchestrationThread` / `ThreadCreateCommand` / `ThreadCreatedPayload`; DB migrations 017 (`history_import_catalog`) and 018 (`thread_external_links`); repository service interfaces and Effect layer implementations; `providerThreadId` index on `projection_threads`
**Features addressed:** Schema prerequisite for all P1 features
**Pitfalls addressed:** Deduplication infrastructure (Pitfall 3); external link lifecycle isolation (Architecture anti-pattern 2)
**Research flag:** Skip — all patterns are directly observable in the existing codebase. No external research needed.

### Phase 2: Codex Import Pipeline (Server)
**Rationale:** Codex is the primary provider for XBE Code. The Codex reader is the most complex (two JSONL formats, SQLite metadata, context compaction, encrypted fields, subagent sessions). Proving the end-to-end pipeline with the hardest provider first validates the architecture before adding Claude Code and Gemini.
**Delivers:** `CodexHistoryScanner` with dual-format detection (`.json` + `.jsonl` rollouts); `parseCodexRollout.ts` with compaction handling and encrypted field skipping; `ProviderHistoryScanner` fanout (single-provider initially); `HistoryImportService` with `listCatalog` / `preview` / `execute`; `materializeImportedThread.ts` dispatching through `OrchestrationEngine`; `import.discover` WS method; `tinyglobby` added to `apps/server`
**Pitfalls addressed:** Memory streaming (Pitfall 1); context compaction (Pitfall 2); duplicate prevention (Pitfall 3); format versioning (Pitfall 4); file locking (Pitfall 6); subagent filtering (Pitfall 7); interrupted sessions (Pitfall 8)
**Research flag:** Codex rollout format details (field names, compaction event type names) need confirmation against real fixture files or the Codex changelog. The `state_5.sqlite` schema (thread table columns) should be validated against an actual Codex installation before finalizing `parseCodexRollout.ts`.

### Phase 3: Import UI (Web)
**Rationale:** The server pipeline from Phase 2 is fully testable without UI. Building UI after server allows wire-format validation via integration tests first. The UI depends on the WS method signatures stabilized in Phase 2.
**Delivers:** `ImportConversationsDialog` (5-step flow: provider/scope → select → preview → options → result); workspace-scoped session list with already-imported badge; per-thread checkbox selection; import progress feedback; per-thread error display; navigation to new thread after import
**Features addressed:** All P1 UX features (table stakes list)
**Pitfalls addressed:** UX clutter — default to last 30 sessions; resumability distinction surface (Pitfall 10)
**Research flag:** Skip — standard modal/drawer pattern, well-understood in the existing React codebase.

### Phase 4: Claude Code Import + Native Codex Resume
**Rationale:** Claude Code is the second most important provider. Native Codex resume (`thread/resume` with stored `providerThreadId`) delivers the highest-value differentiator and requires only schema work that landed in Phase 1. Shipping both together keeps the "import then resume" story coherent.
**Delivers:** `ClaudeHistoryScanner` with lossy path encoding match (forward-encode only), `sessions-index.json` optional fallback, incremental scan stop-after-metadata; `parseClaudeSession.ts`; native Codex resume wired in `ThreadImportProvenanceCard`; `resumeCapability` field on external link record distinguishing `"native"` / `"replay"` / `"read-only"`; auto-discovery badge on project open
**Pitfalls addressed:** Path encoding collisions (Pitfall 5); Claude-specific format evolution (Pitfall 4)
**Research flag:** The Claude Code JSONL schema (field names for `sessionId`, `timestamp`, `type`, message `role`) needs validation against real session files — secondary sources used in the research; confirm against an actual `~/.claude/projects/` installation.

### Phase 5: Hardening, Link Validation, and Notifications
**Rationale:** `validateExternalLink` (link freshness checking) and the `ThreadImportProvenanceCard` UX are lower priority than getting data in. Shipping them in a follow-up phase keeps v1 scope tight while delivering the "import summary notification" and "validate link lazily on thread open" behavior cleanly.
**Delivers:** `validateExternalLink.ts` with fingerprint freshness check; `ThreadImportProvenanceCard` on thread view (origin, validation badge, lazy validation on open); import summary notification via existing notification system; `importStatus: "failed-partial"` warning badge; `forceRefresh` scan trigger from UI
**Pitfalls addressed:** Stale badge proliferation — validate lazily on thread open, not on list render (Pitfall 10); partial import surfacing (Pitfall 3)
**Research flag:** Skip — patterns are well-defined in the architecture research.

### Phase 6: Gemini CLI Reader (Deferred)
**Rationale:** Gemini CLI auto-save is a requested but not stably shipped feature as of March 2026 (open GitHub discussions, no stable path). Shipping Gemini support now risks building against a format that changes before users adopt it. Defer until the format stabilizes.
**Delivers:** `GeminiHistoryScanner` with dual-directory scan (hash-based + slug-based); `parseGeminiSession.ts`; `resumeCapability: "read-only"` for Gemini threads
**Pitfalls addressed:** Gemini hash-to-slug migration (Pitfall 4)
**Research flag:** Needs research at planning time — the Gemini CLI session storage format is the least well-documented of the three; validate against actual `~/.gemini/tmp/` structure before building.

### Phase Ordering Rationale

- Phase 1 before all others: schema and DB migrations are hard dependencies; nothing compiles without them.
- Phase 2 before Phase 3: server integration tests validate the pipeline before UI is written; avoids building UI against an unstable wire format.
- Phase 3 delivers user-visible value from Phase 2 immediately; keeps the Codex-first story intact for v1.
- Phase 4 groups Claude Code and native resume because native resume is schema-complete from Phase 1 and the Claude provenance card (Phase 5) depends on it — batching reduces UI churn.
- Phase 5 is hardening; it does not block user value but is required for production quality.
- Phase 6 is intentionally deferred; Gemini's format immaturity makes earlier investment wasteful.

### Research Flags

**Needs research during planning:**
- **Phase 2:** Codex rollout JSONL field names for compaction events (`context_compaction` vs `compaction_summary` vs other); `state_5.sqlite` thread table schema columns. Validate against a real Codex installation or the Codex open-source repo before finalizing `parseCodexRollout.ts`.
- **Phase 4:** Claude Code JSONL field names (`sessionId`, `timestamp`, role values). Secondary sources used in feature research — confirm against a real `~/.claude/projects/` session file before building `parseClaudeSession.ts`.
- **Phase 6:** Full Gemini CLI session format validation required — open GitHub issues indicate the format is still in flux.

**Standard patterns (skip research-phase):**
- **Phase 1:** Effect layer/service split, DB migration numbering, contract schema pattern — all directly observable in existing codebase.
- **Phase 3:** React modal, checkbox list, WebSocket RPC client pattern — standard in existing web app.
- **Phase 5:** Effect retry, fingerprint comparison, notification dispatch — all existing infrastructure.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations grounded in installed source code inspection (effect-smol `8881a9b`). `tinyglobby` recommendation based on 2025/2026 community adoption data. No speculative dependencies. |
| Features | HIGH (Codex/Claude) / LOW (Gemini) | Codex and Claude Code provider formats confirmed by official docs and multiple secondary sources. Gemini auto-save format is LOW confidence — open issues indicate it is not stably shipped. Competitor analysis is HIGH confidence (official docs for all competitors). |
| Architecture | HIGH | All patterns derived directly from the live XBE codebase — not from external references. `OrchestrationEngine`, `ProjectionPipeline`, `NodeSqliteClient`, and the `Services/Layers` split are confirmed by direct file inspection. |
| Pitfalls | HIGH | 8 of 12 pitfalls are grounded in documented provider behavior (official changelogs, GitHub issues, SQLite WAL documentation). 4 pitfalls (subagent filtering heuristics, Gemini format edge cases) are inferred from general patterns and should be validated against real fixture files. |

**Overall confidence: HIGH** for the Codex-first v1 scope. MEDIUM for Claude Code (format field names need real-file validation). LOW for Gemini (format too unstable to plan against).

### Gaps to Address

- **Codex `state_5.sqlite` schema**: Column names and types for the threads table are not confirmed from a primary source (the research used a secondary source, deepwiki). Validate against an actual Codex installation or the Codex open-source repo before writing `parseCodexRollout.ts`.
- **Codex compaction event type name**: Research identifies `context_compaction` / `compaction_summary` as likely event type names from secondary sources. Confirm exact type string from the Codex CHANGELOG or open-source rollout format before shipping.
- **Claude Code JSONL field names**: Field names (`sessionId`, `timestamp`, message `role`) used in secondary sources need confirmation against a real session file. The Claude Code session format is not officially documented.
- **Gemini CLI session format**: Deferred to Phase 6. Do not plan against this until the format is stable and confirmed.
- **`thread/resume` JSON-RPC behavior with old session IDs**: Codex app-server may reject a `thread/resume` call if the session has been garbage-collected by Codex. Need to handle `resumeCapability: "native"` degrading to `"replay"` or `"read-only"` at resume time. Validate against the Codex app-server docs.

---

## Sources

### Primary (HIGH confidence)
- XBE Code codebase (`apps/server/src/`, `packages/contracts/src/`, `apps/web/src/`) — all architecture patterns and stack decisions
- Effect-smol installed source at `apps/server/node_modules/.bun/effect@.../` — FileSystem API, Stream API, Ndjson encoding, NodeSqliteClient
- Codex app-server protocol: https://developers.openai.com/codex/app-server/ — `thread/resume` JSON-RPC behavior
- SQLite WAL concurrency: https://www.sqlite.org/wal.html — WAL mode read-only safety, SQLITE_BUSY behavior
- Cursor export: https://cursor.com/docs/agent/chat/export — competitor feature baseline
- VS Code Copilot chat export: https://code.visualstudio.com/docs/copilot/chat/chat-sessions — competitor feature baseline

### Secondary (MEDIUM confidence)
- Codex session storage: https://dev.to/shinshin86/no-resume-in-codex-cli-so-i-built-one-quickly-continue-with-codex-history-list-50be
- Codex SQLite memory system: https://deepwiki.com/openai/codex/3.7-memory-system — `state_5.sqlite` schema (needs primary-source validation)
- Claude Code session storage: https://kentgigger.com/posts/claude-code-conversation-history — consistent with GitHub issue #9306
- Codex context compaction: Codex GitHub CHANGELOG entries — event type names need real-file confirmation
- Data importer UX patterns: https://www.smashingmagazine.com/2020/12/designing-attractive-usable-data-importer-app/

### Tertiary (LOW confidence — needs validation)
- Gemini CLI session storage: https://github.com/google-gemini/gemini-cli/discussions/4974 and https://github.com/google-gemini/gemini-cli/issues/5101 — open issues indicate auto-save is incomplete
- Gemini hash-to-slug migration: https://github.com/google-gemini/gemini-cli/discussions/4974 — community report, not official docs

---

*Research completed: 2026-03-12*
*Ready for roadmap: yes*
