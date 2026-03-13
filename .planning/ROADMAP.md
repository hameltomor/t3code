# Roadmap: XBE Code

## Milestones

- ✅ **v1.0 Chat History Import** -- Phases 1-5.1 (shipped 2026-03-12)
- 🚧 **v1.1 Session Context Status** -- Phases 7-10 (in progress)
- 📋 **Deferred** -- Phase 6 Gemini CLI Import (blocked on upstream format)

## Phases

<details>
<summary>v1.0 Chat History Import (Phases 1-5.1) -- SHIPPED 2026-03-12</summary>

- [x] Phase 1: Foundation and Schema (2/2 plans) -- completed 2026-03-12
- [x] Phase 2: Codex Import Pipeline (3/3 plans) -- completed 2026-03-12
- [x] Phase 3: Import UI (2/2 plans) -- completed 2026-03-12
- [x] Phase 4: Claude Code Import and Native Resume (2/2 plans) -- completed 2026-03-12
- [x] Phase 5: Hardening and Provenance (3/3 plans) -- completed 2026-03-12
- [x] Phase 5.1: Import Pipeline Bug Fixes (1/1 plan) -- completed 2026-03-12

See `milestones/v1.0-ROADMAP.md` for full details.

</details>

### Deferred

- [ ] **Phase 6: Gemini CLI Reader** -- Deferred until format stabilizes upstream
  - **Status**: Deferred -- Gemini CLI auto-save format is actively changing. Re-evaluate when stable.

### v1.1 Session Context Status

**Milestone Goal:** Users can see real-time context window usage during a session, across all three providers, with honest source/freshness labeling and no fake precision.

- [x] **Phase 7: Schema Foundation and Context Window Registry** -- Canonical types and model limit resolver that all layers depend on -- completed 2026-03-13
- [x] **Phase 8: Provider Normalization** -- All three adapters emit typed canonical token usage events -- completed 2026-03-13
- [x] **Phase 9: Server Pipeline and Persistence** -- Ingestion, projection, persistence, and snapshot hydration for context status -- completed 2026-03-13
- [ ] **Phase 10: UI Integration** -- Context status badge in composer footer with threshold coloring and graceful degradation

## Phase Details

### Phase 7: Schema Foundation and Context Window Registry
**Goal**: Typed canonical schemas and model limit resolution exist so every downstream layer can build on verified types instead of `Schema.Unknown`
**Depends on**: Nothing (first phase of v1.1; builds on existing v1.0 infrastructure)
**Requirements**: SDM-01, SDM-02, SDM-03, SDM-04, SDM-05, SDM-06, SDM-07, SDM-08, REG-01, REG-02, REG-03, REG-04, REG-05
**Success Criteria** (what must be TRUE):
  1. `NormalizedTokenUsage` schema in contracts replaces all `Schema.Unknown` usage fields with typed canonical structure that compiles and validates
  2. `OrchestrationThreadContextStatus` schema is defined with all typed enums (support, source, freshness, status), compaction history, and measuredAt -- and `contextStatus` field exists on `OrchestrationThread`
  3. `ContextWindowRegistry` resolves known model slugs (including aliases like "opus") to their context window limits, returns `null` for unknown models, and never guesses
  4. `thread.context-status.set` command is defined in contracts and added to the orchestration command union
  5. `bun typecheck` passes with the new schemas integrated across contracts, server, and web packages
**Plans**: 2 plans

Plans:
- [x] 07-01: Canonical token usage and context status schemas in contracts
- [x] 07-02: Context window registry and command definitions

### Phase 8: Provider Normalization
**Goal**: All three provider adapters emit typed `thread.token-usage.updated` events with canonical payloads, so the server pipeline has uniform input regardless of provider
**Depends on**: Phase 7 (canonical schemas must exist)
**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07, TEST-01
**Success Criteria** (what must be TRUE):
  1. Codex adapter passes through `thread.token-usage.updated` events with typed canonical payload (not raw `Schema.Unknown`) and labels support as "native"
  2. Claude Code adapter emits `thread.token-usage.updated` from assistant/result message usage fields, emits compaction-correlated status on `compact_boundary`, and labels support as "derived-live"
  3. Gemini adapter emits `thread.token-usage.updated` from `usageMetadata` on turn completion, labels support as "derived-on-demand", and `countTokens` failures never block turns or surface as user-visible errors
  4. A typed normalization layer converts all three provider-specific usage payloads into `NormalizedTokenUsage` before any downstream consumption
  5. Cross-provider fixture tests verify normalization of real Codex, Claude, and Gemini usage payloads into canonical form
**Plans**: 2 plans

Plans:
- [x] 08-01: Typed normalization layer and Codex adapter passthrough
- [x] 08-02: Claude Code and Gemini adapter emission with fixture tests

### Phase 9: Server Pipeline and Persistence
**Goal**: Token usage events flow through the full server pipeline -- ingestion, projection, persistence, snapshot hydration -- so context status is available on every `OrchestrationThread` pushed to clients
**Depends on**: Phase 7 (schemas), Phase 8 (adapters emit events)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, TEST-02, TEST-04
**Success Criteria** (what must be TRUE):
  1. `ProviderRuntimeIngestion` handles `thread.token-usage.updated` and dispatches `thread.context-status.set` to the orchestration engine -- context status computation never blocks turn start/send
  2. `projection_thread_context_status` SQLite table exists via migration, and a projector persists context status on every `thread.context-status-set` event
  3. `ProjectionSnapshotQuery` hydrates `thread.contextStatus` from the projection table onto every `OrchestrationThread` snapshot
  4. Context status projection is supplementary (not in `REQUIRED_SNAPSHOT_PROJECTORS`) so it never blocks snapshot reads, and server-side dedup/throttle prevents excessive writes from high-frequency token events
  5. End-to-end integration test verifies the full flow: provider event to ingestion to projection to snapshot to WebSocket push
**Plans**: 2 plans

Plans:
- [x] 09-01: Migration, repository, and projector for context status persistence
- [x] 09-02: Ingestion handler, snapshot hydration, throttle, and integration tests

### Phase 10: UI Integration
**Goal**: Users see live context window usage in the composer footer with honest labeling, threshold coloring, and graceful degradation for unknown or stale data
**Depends on**: Phase 7 (contracts for web types), Phase 9 (projection push via WebSocket)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, TEST-03
**Success Criteria** (what must be TRUE):
  1. Minimal badge in composer footer shows "Context XX%" with threshold coloring (neutral <70%, watch 70-85%, warning 85-95%, danger >=95%) -- badge is not rendered when session is stopped or no session exists
  2. When model limit is unknown, UI shows "Context unknown" -- never a fake percentage; when freshness is stale, UI shows last updated time
  3. Full pill + tooltip mode shows source label, exact token counts, freshness, and compaction history -- minimal badge is the shipped default, full pill is feature-flagged/internal only
  4. "Compacted recently" state is displayed when last compaction is within threshold, with timestamp in tooltip; UI applies hysteresis (500ms debounce minimum) to prevent visual flicker
  5. UI rendering tests cover unknown state, stale freshness, compacted state, and all threshold transitions
**Plans**: 2 plans

Plans:
- [ ] 10-01: Context status store mapping and ContextStatusIndicator component
- [ ] 10-02: Full pill mode, edge states, hysteresis, and rendering tests

## Progress

**Execution Order:**
Phases execute in numeric order: 7 -> 8 -> 9 -> 10
Note: Phase 8 (adapter normalization) can begin as soon as Phase 7 completes, and Phase 9 (pipeline) can develop in parallel with Phase 8 for persistence/migration work, but ingestion handler needs adapter events flowing.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation and Schema | v1.0 | 2/2 | Complete | 2026-03-12 |
| 2. Codex Import Pipeline | v1.0 | 3/3 | Complete | 2026-03-12 |
| 3. Import UI | v1.0 | 2/2 | Complete | 2026-03-12 |
| 4. Claude Code Import and Native Resume | v1.0 | 2/2 | Complete | 2026-03-12 |
| 5. Hardening and Provenance | v1.0 | 3/3 | Complete | 2026-03-12 |
| 5.1. Import Pipeline Bug Fixes | v1.0 | 1/1 | Complete | 2026-03-12 |
| 6. Gemini CLI Reader | Deferred | 0/0 | Deferred | - |
| 7. Schema Foundation and Context Window Registry | v1.1 | 2/2 | Complete | 2026-03-13 |
| 8. Provider Normalization | v1.1 | 2/2 | Complete | 2026-03-13 |
| 9. Server Pipeline and Persistence | v1.1 | 2/2 | Complete | 2026-03-13 |
| 10. UI Integration | v1.1 | 0/2 | Not started | - |
