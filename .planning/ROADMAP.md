# Roadmap: History Import

## Overview

Build a history import system that lets users discover, preview, and selectively import existing conversations from Codex CLI and Claude Code into XBE Code. The roadmap starts with shared schema and persistence infrastructure, proves the end-to-end pipeline with Codex (the hardest and most important provider), delivers the import UI, adds Claude Code support with native resume, hardens link validation and provenance display, and defers Gemini until its format stabilizes.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation and Schema** - Contracts, migrations, and repository infrastructure that gate all subsequent work
- [x] **Phase 2: Codex Import Pipeline** - End-to-end server pipeline for the hardest provider: scan, preview, import, dedupe
- [x] **Phase 3: Import UI** - 5-step import wizard in the web app consuming the server pipeline
- [x] **Phase 4: Claude Code Import and Native Resume** - Second provider reader plus native Codex resume wiring
- [ ] **Phase 5: Hardening and Provenance** - Link validation, thread provenance card, notifications, partial-import surfacing
- [ ] **Phase 6: Gemini CLI Reader** - Deferred until format stabilizes upstream

## Phase Details

### Phase 1: Foundation and Schema
**Goal**: All shared types, database tables, and repository services exist so that subsequent phases can build against stable interfaces without schema churn
**Depends on**: Nothing (first phase)
**Requirements**: FR-1 (schema/table portion), FR-3 (schema/table portion), NFR-7
**Success Criteria** (what must be TRUE):
  1. `packages/contracts/src/historyImport.ts` exports all enums, summary, preview, execute, and external link schemas and the contract compiles cleanly
  2. `providerThreadId` field exists on `OrchestrationThread`, `ThreadCreateCommand`, and `ThreadCreatedPayload` with a unique index on `projection_threads`
  3. Migrations 017 (`history_import_catalog`) and 018 (`thread_external_links`) run successfully and the tables exist in the XBE SQLite database
  4. `HistoryImportCatalogRepository` and `ThreadExternalLinkRepository` Effect services can upsert, query, and delete rows against their respective tables
  5. WS method stubs for `historyImport.list`, `historyImport.preview`, `historyImport.execute`, `historyImport.validateLink`, and `historyImport.listThreadLinks` are routed in `wsServer.ts` (returning not-implemented errors is acceptable)
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Contracts and schema definitions (historyImport.ts, providerThreadId on orchestration, WS method/channel registration)
- [x] 01-02-PLAN.md -- Database migrations, repository services, projection pipeline wiring, and WS method stubs

### Phase 2: Codex Import Pipeline
**Goal**: Users can discover, preview, and import Codex CLI conversations into XBE threads through the server API (no UI yet -- testable via WS calls)
**Depends on**: Phase 1
**Requirements**: FR-1 (Codex scan), FR-2, FR-3, FR-4, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5
**Success Criteria** (what must be TRUE):
  1. `historyImport.list` returns Codex sessions scoped to the current workspace root, with correct title, message count, date, and fingerprint
  2. `historyImport.preview` returns a capped message and activity sample for a Codex session without loading the full JSONL file into memory
  3. `historyImport.execute` creates a normal XBE thread with the imported transcript projected through `OrchestrationEngine.dispatch`, and persists a `ThreadExternalLink` row
  4. Re-importing the same Codex session is rejected with a reference to the existing thread (deduplication via `providerKind + providerThreadId`)
  5. Context compaction events are handled correctly: pre-compaction messages are discarded and replaced by the compaction summary
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md -- Codex rollout schemas, import orchestration commands (thread.message.import, thread.activity.import), and CodexHistoryScanner
- [x] 02-02-PLAN.md -- Streaming CodexRolloutParser with compaction handling, and HistoryImportService with list/preview methods
- [x] 02-03-PLAN.md -- HistoryMaterializer, HistoryImportService.execute, WS method handlers, and serverLayers wiring

### Phase 3: Import UI
**Goal**: Users can open the import wizard from the sidebar or empty-thread state, browse discovered sessions, preview transcripts, configure import options, and navigate to the created thread
**Depends on**: Phase 2
**Requirements**: FR-8
**Success Criteria** (what must be TRUE):
  1. Import wizard is accessible from the project sidebar menu ("Import Conversations") and from the empty-thread state ("Import existing chat")
  2. Step 1 shows provider tabs (All/Codex/Claude Code/Gemini), current workspace root, and a refresh button that triggers a new scan
  3. Step 2 shows a filterable session list with provider badge, title, cwd, date, message count, resume mode badge, and an "already imported" badge for previously imported sessions
  4. Steps 3-4 show transcript preview with warnings and import options (title, model, runtime mode, interaction mode, link mode)
  5. Step 5 shows the import result with a link to navigate to the created thread, and a toast confirms import counts
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- NativeApi transport, React Query integration, wizard dialog shell with steps 1-2, sidebar and empty-thread entry points
- [x] 03-02-PLAN.md -- Preview step, import options step, result step with thread navigation, execute mutation, and toast notification

### Phase 4: Claude Code Import and Native Resume
**Goal**: Users can import Claude Code conversations and resume imported Codex threads natively through the original provider session
**Depends on**: Phase 2, Phase 3
**Requirements**: FR-5, FR-7
**Success Criteria** (what must be TRUE):
  1. `historyImport.list` returns Claude Code sessions discovered via forward-encoded workspace path matching, with fallback when `sessions-index.json` is absent
  2. Claude Code sessions with `thinking` blocks and `tool_use` blocks are correctly mapped to activities (not message text)
  3. An imported Codex thread with `linkMode = native-resume` can be continued through XBE by passing the stored `providerThreadId` to the Codex `thread/resume` JSON-RPC call
  4. The UI clearly distinguishes "Resume original session" from "Continue from imported transcript" based on link mode
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- Claude Code JSONL schemas, history scanner with sessions-index.json + header fallback, streaming session parser, HistoryImportService integration, serverLayers wiring
- [x] 04-02-PLAN.md -- Native resume via ThreadExternalLink lookup in ProviderCommandReactor, provider-aware link mode descriptions in import wizard UI

### Phase 5: Hardening and Provenance
**Goal**: Imported threads display their origin, link validation runs lazily on thread open, and the system surfaces partial imports and stale links without destroying data
**Depends on**: Phase 4
**Requirements**: FR-9, NFR-6
**Success Criteria** (what must be TRUE):
  1. Thread view shows a provenance card with provider origin, original cwd, imported-at timestamp, link mode, and validation status
  2. Opening an imported thread triggers lazy link validation that checks source path existence and fingerprint freshness, updating the validation badge without blocking the thread view
  3. Thread list supports filtering by "Native" / "Imported" / "All" and shows a source badge on imported threads
  4. Partially imported threads (where transcript import failed after thread creation) display a warning badge rather than being silently deleted
  5. Catalog scans complete within 5 seconds for 100 sessions, preview returns within 2 seconds, and import of a 500-message thread completes within 10 seconds
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md -- Shared fingerprint utility, server-side validateLink implementation, contracts and WS wiring, ProvenanceCard component with lazy background validation in ChatView
- [ ] 05-02-PLAN.md -- Sidebar source badges and All/Native/Imported filter toggle, partial-import detection via two-phase materializer status

### Phase 6: Gemini CLI Reader (DEFERRED)
**Goal**: Users can import Gemini CLI conversations with transcript-replay continuation mode
**Depends on**: Phase 2, Phase 3
**Requirements**: FR-6
**Status**: Deferred -- Gemini CLI auto-save is not stably shipped as of March 2026. The on-disk format is actively changing (hash-to-slug migration, open GitHub issues). Building against it now risks wasted work. Re-evaluate when the format stabilizes.
**Success Criteria** (what must be TRUE):
  1. `historyImport.list` returns Gemini sessions discovered via both hash-based and slug-based project directories
  2. Gemini sessions are imported with `linkMode = transcript-replay` (not native-resume)
  3. The UI labels Gemini continuation as "Continue from imported transcript", not "Resume original Gemini session"
**Plans**: TBD

Plans:
- [ ] 06-01: Gemini history scanner and parser

## Requirement Coverage

| Requirement | Phase | Description |
|-------------|-------|-------------|
| FR-1 | Phase 1, Phase 2 | Discovery Catalog (schema in P1, Codex scan in P2) |
| FR-2 | Phase 2 | Conversation Preview |
| FR-3 | Phase 1, Phase 2 | Import Materialization (schema in P1, pipeline in P2) |
| FR-4 | Phase 2 | Codex Provider Support |
| FR-5 | Phase 4 | Claude Code Provider Support |
| FR-6 | Phase 6 (Deferred) | Gemini Provider Support |
| FR-7 | Phase 4 | Native Resume for Imported Threads |
| FR-8 | Phase 3 | Import UI |
| FR-9 | Phase 5 | Thread Provenance Display |
| NFR-1 | Phase 2 | Memory Safety (streaming JSONL) |
| NFR-2 | Phase 2 | Read-Only Provider Access |
| NFR-3 | Phase 2 | Privacy |
| NFR-4 | Phase 2 | Scan Isolation |
| NFR-5 | Phase 2 | Schema Tolerance |
| NFR-6 | Phase 5 | Performance |
| NFR-7 | Phase 1 | Architecture Separation |

All 16 requirements mapped. FR-6 is deferred to Phase 6.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> (6 when unblocked)

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Foundation and Schema | 2/2 | Complete | 2026-03-12 |
| 2. Codex Import Pipeline | 3/3 | Complete | 2026-03-12 |
| 3. Import UI | 2/2 | Complete | 2026-03-12 |
| 4. Claude Code Import and Native Resume | 2/2 | Complete | 2026-03-12 |
| 5. Hardening and Provenance | 0/2 | Not started | - |
| 6. Gemini CLI Reader | 0/1 | Deferred | - |
