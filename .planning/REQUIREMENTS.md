# Requirements: XBE Code — Session Context Status

**Defined:** 2026-03-13
**Core Value:** Users can see how much of their context window is consumed during a session, across all providers, without fake precision or hidden complexity.

## v1.1 Requirements

### Schema & Data Model (SDM)

- [ ] **SDM-01**: Normalized token usage schema replaces all `Schema.Unknown` usage fields with typed canonical structure (inputTokens, outputTokens, cachedInputTokens, reasoningTokens, totalTokens)
- [ ] **SDM-02**: `OrchestrationThreadContextStatus` schema is defined as a separate thread-scoped type with provider, support, source, freshness, status, model, token fields, percent, compaction history, and measuredAt
- [ ] **SDM-03**: `OrchestrationThreadContextStatus.support` is typed as `"native" | "derived-live" | "derived-on-demand" | "unsupported"`
- [ ] **SDM-04**: `OrchestrationThreadContextStatus.source` is typed as `"provider-event" | "sdk-usage" | "count-tokens" | "heuristic"`
- [ ] **SDM-05**: `OrchestrationThreadContextStatus.freshness` is typed as `"live" | "stale" | "unknown"`
- [ ] **SDM-06**: `OrchestrationThreadContextStatus.status` is typed as `"ok" | "watch" | "near-limit" | "compacted" | "unknown"`
- [ ] **SDM-07**: Compaction history is limited to `lastCompactedAt`, `lastCompactionReason`, and optional `compactionCount` — no full compaction log
- [ ] **SDM-08**: `contextStatus` field is added to `OrchestrationThread` in contracts

### Model Registry (REG)

- [ ] **REG-01**: `ContextWindowRegistry` is a hybrid resolver with fallback chain: alias resolution → static local map → provider/API metadata lookup → `null`
- [ ] **REG-02**: Static local map covers all models in `MODEL_OPTIONS_BY_PROVIDER` with known public limits; easily updatable when models change
- [ ] **REG-03**: Registry returns `null` for unknown or unresolved model slugs — never a fallback guess
- [ ] **REG-04**: Registry resolves model aliases (e.g., "opus" → "claude-opus-4-6") before lookup, using existing `normalizeModelSlug`
- [ ] **REG-05**: Provider/API metadata fallback is available where supported (e.g., Gemini model metadata) but is optional and never blocks

### Provider Normalization (PROV)

- [ ] **PROV-01**: Codex adapter passes through existing `thread.token-usage.updated` events with typed canonical payload instead of raw `Schema.Unknown`
- [ ] **PROV-02**: Claude Code adapter emits `thread.token-usage.updated` from assistant/result message `usage` fields whenever usage materially changes
- [ ] **PROV-03**: Claude Code adapter emits compaction-correlated context status update when `compact_boundary` arrives
- [ ] **PROV-04**: Gemini adapter extracts `usageMetadata` from `generateContent` responses and emits `thread.token-usage.updated`
- [ ] **PROV-05**: Gemini `countTokens` failures are best-effort — they never block turns or surface as user-visible errors
- [ ] **PROV-06**: All three adapters label their support tier: Codex=native, Claude=derived-live, Gemini=derived-on-demand
- [ ] **PROV-07**: A typed usage normalization layer converts provider-specific usage payloads into canonical `NormalizedTokenUsage` before any projection work

### Server Pipeline (PIPE)

- [ ] **PIPE-01**: `ProviderRuntimeIngestion` handles `thread.token-usage.updated` events and dispatches `thread.context-status.set` orchestration command
- [ ] **PIPE-02**: A new orchestration command `thread.context-status.set` is defined in contracts
- [ ] **PIPE-03**: `ProjectionPipeline` persists context status to a dedicated `projection_thread_context_status` table via new projector
- [ ] **PIPE-04**: `ProjectionSnapshotQuery` hydrates `thread.contextStatus` from the projection table
- [ ] **PIPE-05**: Database migration adds `projection_thread_context_status` table with appropriate columns
- [ ] **PIPE-06**: Server-side deduplication/throttle prevents high-frequency token events from causing excessive projection writes or WebSocket pushes
- [ ] **PIPE-07**: Context status projection is supplementary — not in `REQUIRED_SNAPSHOT_PROJECTORS` — so it does not block snapshot reads
- [ ] **PIPE-08**: Context status computation never blocks turn start/send; on failure, preserve last known value and mark freshness as stale

### UI Display (UI)

- [ ] **UI-01**: Minimal badge in composer footer shows "Context XX%" with threshold coloring: neutral (<70%), watch (70-85%), warning (85-95%), danger (>=95%)
- [ ] **UI-02**: Full pill + tooltip mode shows source label, exact token counts, freshness, compaction history — both render modes are implemented
- [ ] **UI-03**: Minimal badge is the shipped default; full pill + tooltip is feature-flagged/internal only (not user-configurable until settings UI exists)
- [ ] **UI-04**: When model limit is unknown, UI shows "Context unknown" — never a fake percentage
- [ ] **UI-05**: When freshness is stale, UI shows last updated time
- [ ] **UI-06**: "Compacted recently" state is displayed when last compaction is within threshold, with timestamp in tooltip
- [ ] **UI-07**: UI applies hysteresis to prevent visual flicker from rapid updates (e.g., debounce rendering at 500ms minimum)
- [ ] **UI-08**: Context status badge is not rendered when session is stopped or no session exists

### Testing & Verification (TEST)

- [ ] **TEST-01**: Cross-provider fixture tests verify normalization of Codex, Claude, and Gemini raw usage payloads into canonical `NormalizedTokenUsage`
- [ ] **TEST-02**: Projection migration and hydration tests verify `projection_thread_context_status` table creation, upsert, and snapshot query
- [ ] **TEST-03**: UI rendering tests cover unknown state, stale freshness, compacted state, and all threshold transitions (neutral → watch → warning → danger)
- [ ] **TEST-04**: Integration test verifies end-to-end flow: provider event → ingestion → projection → snapshot → WebSocket push

## v2 Requirements

### Settings

- **SET-01**: User can toggle between minimal badge and full pill + tooltip mode in settings UI
- **SET-02**: User can configure threshold percentages for watch/warning/danger in settings

### Extended Tracking

- **EXT-01**: Rate limit status displayed alongside context status
- **EXT-02**: Cost tracking per session displayed in context pill
- **EXT-03**: Historical context usage chart over session lifetime

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rate limit display in context pill | Separate concern, different update cadence — v2 |
| Cost tracking in context pill | Different domain, requires price-per-token data — v2 |
| Browser-side token counting | Architecture requires server-side normalization, not client computation |
| Per-message token attribution | Context status is thread-scoped runtime state, not message-scoped |
| Automatic compaction trigger from UI | Provider controls compaction; UI is read-only observer |
| Provider-specific UI branches | All rendering uses normalized data; no provider conditionals in components |
| Settings UI for display mode toggle | Component supports mode prop; settings page is v2 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SDM-01 | — | Pending |
| SDM-02 | — | Pending |
| SDM-03 | — | Pending |
| SDM-04 | — | Pending |
| SDM-05 | — | Pending |
| SDM-06 | — | Pending |
| SDM-07 | — | Pending |
| SDM-08 | — | Pending |
| REG-01 | — | Pending |
| REG-02 | — | Pending |
| REG-03 | — | Pending |
| REG-04 | — | Pending |
| REG-05 | — | Pending |
| PROV-01 | — | Pending |
| PROV-02 | — | Pending |
| PROV-03 | — | Pending |
| PROV-04 | — | Pending |
| PROV-05 | — | Pending |
| PROV-06 | — | Pending |
| PROV-07 | — | Pending |
| PIPE-01 | — | Pending |
| PIPE-02 | — | Pending |
| PIPE-03 | — | Pending |
| PIPE-04 | — | Pending |
| PIPE-05 | — | Pending |
| PIPE-06 | — | Pending |
| PIPE-07 | — | Pending |
| PIPE-08 | — | Pending |
| UI-01 | — | Pending |
| UI-02 | — | Pending |
| UI-03 | — | Pending |
| UI-04 | — | Pending |
| UI-05 | — | Pending |
| UI-06 | — | Pending |
| UI-07 | — | Pending |
| UI-08 | — | Pending |
| TEST-01 | — | Pending |
| TEST-02 | — | Pending |
| TEST-03 | — | Pending |
| TEST-04 | — | Pending |

**Coverage:**
- v1.1 requirements: 40 total
- Mapped to phases: 0
- Unmapped: 40 ⚠️

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-13 after initial definition*
