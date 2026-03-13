# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Users can interact with multiple code agents through one unified interface without losing context, visibility, or control
**Current focus:** v1.1 Session Context Status -- Phase 10 (UI Context Status Badge) COMPLETE

## Current Position

Phase: 10 of 10 (UI Context Status Badge)
Plan: 2 of 2 in current phase (COMPLETE)
Status: v1.1 Milestone Complete
Last activity: 2026-03-13 -- Completed 10-02 (Context Status Badge Tests and Polish)

Progress: [██████████] 100% (v1.1: 8/8 plans)

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 13
- Average duration: 7min
- Total execution time: 1.43 hours

**v1.1 Velocity:**
- Total plans completed: 8
- Average duration: 5min
- Total execution time: 0.65 hours

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 07 | 01 | 6min | 2 | 8 |
| 07 | 02 | 4min | 2 | 4 |
| 08 | 01 | 3min | 2 | 3 |
| 08 | 02 | 7min | 2 | 3 |
| 09 | 01 | 5min | 2 | 8 |
| 09 | 02 | 8min | 2 | 3 |
| 10 | 01 | 3min | 2 | 7 |
| 10 | 02 | 3min | 2 | 4 |

## Accumulated Context

### Decisions

All v1.0 decisions archived in PROJECT.md Key Decisions table and milestones/v1.0-ROADMAP.md.

v1.1 pending decisions (from PROJECT.md):
- Separate thread context projection (context status is a different domain from session lifecycle)
- ContextWindowRegistry for model limits (single resolver with fallback chain, avoids scattering constants)
- Provider support labels (honest about precision differences across providers)
- Minimal badge default (extensible to settings-controlled mode later)

v1.1 execution decisions:
- contextStatus uses NullOr + withDecodingDefault(null) for backward compat with existing persisted data (07-01)
- Command type dot-separated (thread.context-status.set), event type dash-separated (thread.context-status-set) per existing convention (07-01)
- ThreadContextStatusSetCommand is internal-only (not exported), ThreadContextStatusSetPayload is exported (07-01)
- ContextWindowRegistry is pure functions (not Effect Service/Layer) -- no side effects or dependencies (07-02)
- CONTEXT_WINDOW_LIMITS is internal (not exported) to keep API surface minimal (07-02)
- getContextWindowLimit returns null for unknown models, never guesses (07-02)
- Normalization functions are pure TypeScript, raw types are plain TS interfaces (not Effect schemas) (08-01)
- ThreadTokenUsageUpdatedPayload includes support and source metadata alongside usage (08-01)
- Codex adapter defensively skips event emission when tokenUsage is missing (08-01)
- Claude Code result usage accessed via defensive type guard since SDK uses discriminated union (08-02)
- Compact_boundary emits minimal NormalizedTokenUsage with just totalTokens from pre_tokens (08-02)
- Gemini adapter stores lastUsageMetadata on GeminiTurnState for emission in completeTurn (08-02)
- Context status projector is supplementary (not in REQUIRED_SNAPSHOT_PROJECTORS) per PIPE-07 (09-01)
- DB schema uses Schema.String for enum fields -- enums validated at application layer, not persistence (09-01)
- Compaction detection uses 80% threshold: current totalTokens < previous * 0.8 (09-01)
- Effect.catch used instead of Effect.catchAll for dispatch failure handling (effect-smol API) (09-02)
- Ingestion throttle uses in-memory Map per thread, not Cache, for simplicity and zero GC overhead (09-02)
- Logic/view separation: all derivation in .logic.ts, component is thin render layer (10-01)
- sessionActive derived from session existence + status checks (not closed, not stopped) (10-01)
- Badge placed after runtime mode toggle in composer footer left-side controls (10-01)
- Full pill mode controlled by VITE_CONTEXT_STATUS_FULL_PILL env var, defaults to off (10-02)
- COMPACTION_RECENCY_THRESHOLD_MS = 5 minutes as named constant for compacted recently detection (10-02)
- 500ms debounce applied to display object via useDebouncedValue, not to the store or raw data (10-02)
- Relative time formatting uses simple math (Xm ago / Xh ago) without external library (10-02)

### Pending Todos

None.

### Blockers/Concerns

- Phase 6 (Gemini import) blocked on upstream format stabilization
- Codex `thread/tokenUsage/updated` payload shape VERIFIED in Phase 8 -- camelCase, nested total/last, modelContextWindow
- GPT-5.x and Gemini 3.x preview model context limits are MEDIUM confidence -- mark with source comments in registry

## Session Continuity

Last session: 2026-03-13
Stopped at: Completed 10-02-PLAN.md (Context Status Badge Tests and Polish) -- v1.1 milestone complete
Next step: v1.1 milestone complete. All 8 plans across 4 phases executed successfully.
