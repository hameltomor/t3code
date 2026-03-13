# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Users can interact with multiple code agents through one unified interface without losing context, visibility, or control
**Current focus:** v1.1 Session Context Status -- Phase 9 (Server Pipeline and Persistence)

## Current Position

Phase: 9 of 10 (Server Pipeline and Persistence)
Plan: 1 of 2 in current phase
Status: Executing
Last activity: 2026-03-13 -- Completed 09-01 (Context Status Persistence and Projection Pipeline)

Progress: [██████░░░░] 63% (v1.1: 5/8 plans)

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 13
- Average duration: 7min
- Total execution time: 1.43 hours

**v1.1 Velocity:**
- Total plans completed: 5
- Average duration: 5min
- Total execution time: 0.42 hours

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 07 | 01 | 6min | 2 | 8 |
| 07 | 02 | 4min | 2 | 4 |
| 08 | 01 | 3min | 2 | 3 |
| 08 | 02 | 7min | 2 | 3 |
| 09 | 01 | 5min | 2 | 8 |

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

### Pending Todos

None.

### Blockers/Concerns

- Phase 6 (Gemini import) blocked on upstream format stabilization
- Codex `thread/tokenUsage/updated` payload shape VERIFIED in Phase 8 -- camelCase, nested total/last, modelContextWindow
- GPT-5.x and Gemini 3.x preview model context limits are MEDIUM confidence -- mark with source comments in registry

## Session Continuity

Last session: 2026-03-13
Stopped at: Completed 09-01-PLAN.md (Context Status Persistence and Projection Pipeline)
Next step: Execute 09-02 (Ingestion, Snapshot Hydration, and Integration Tests)
