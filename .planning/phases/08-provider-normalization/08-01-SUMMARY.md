---
phase: 08-provider-normalization
plan: 01
subsystem: api
tags: [token-usage, normalization, codex, claude, gemini, effect-schema]

# Dependency graph
requires:
  - phase: 07-schema-foundation-and-context-window-registry
    provides: NormalizedTokenUsage, ContextStatusSupport, ContextStatusSource schemas in orchestration.ts
provides:
  - normalizeCodexUsage, normalizeClaudeUsage, normalizeGeminiUsage pure functions
  - Typed ThreadTokenUsageUpdatedPayload with NormalizedTokenUsage, ContextStatusSupport, ContextStatusSource
  - Provider-specific raw type interfaces (CodexThreadTokenUsage, ClaudeRawUsage, GeminiRawUsageMetadata)
  - Codex adapter emitting typed normalized token usage events
affects: [08-02 (Claude Code and Gemini adapter emission), 09 (ProviderRuntimeIngestion context status dispatch)]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-normalization-functions, provider-specific-raw-types-as-ts-interfaces]

key-files:
  created:
    - apps/server/src/provider/normalization/tokenUsageNormalization.ts
  modified:
    - packages/contracts/src/providerRuntime.ts
    - apps/server/src/provider/Layers/CodexAdapter.ts

key-decisions:
  - "Normalization functions are pure TypeScript (not Effect), raw types are plain interfaces (not Effect schemas)"
  - "ThreadTokenUsageUpdatedPayload includes support and source metadata alongside usage for downstream consumers"
  - "Codex adapter defensively skips event emission when tokenUsage is missing from payload"

patterns-established:
  - "Token usage normalization: pure function per provider, import NormalizedTokenUsage type from contracts"
  - "Provider adapter emission: include support tier and source metadata on every token usage event"

# Metrics
duration: 3min
completed: 2026-03-13
---

# Phase 8 Plan 1: Token Usage Normalization Layer Summary

**Three pure normalization functions (Codex, Claude, Gemini) converting raw provider payloads to typed NormalizedTokenUsage, with Codex adapter wired as first consumer**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T17:44:27Z
- **Completed:** 2026-03-13T17:48:10Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created normalization module with three pure functions covering all three providers' raw token usage shapes
- Replaced Schema.Unknown in ThreadTokenUsageUpdatedPayload with typed NormalizedTokenUsage, ContextStatusSupport, ContextStatusSource
- Wired Codex adapter to use normalizeCodexUsage with defensive null guard and typed metadata

## Task Commits

Each task was committed atomically:

1. **Task 1: Create normalization module and update ThreadTokenUsageUpdatedPayload** - `f42f23b5` (feat)
2. **Task 2: Wire Codex adapter to use normalizeCodexUsage with typed payload** - `1623d225` (feat)

## Files Created/Modified
- `apps/server/src/provider/normalization/tokenUsageNormalization.ts` - Three pure normalization functions and provider-specific raw type interfaces
- `packages/contracts/src/providerRuntime.ts` - ThreadTokenUsageUpdatedPayload now typed with NormalizedTokenUsage, ContextStatusSupport, ContextStatusSource
- `apps/server/src/provider/Layers/CodexAdapter.ts` - Imports and uses normalizeCodexUsage with support/source metadata

## Decisions Made
- Normalization functions are pure TypeScript (not Effect) -- these are simple data transformations with no side effects or dependencies
- Raw provider types defined as plain TS interfaces (not Effect schemas) since they only serve as input descriptions for the normalization functions
- ThreadTokenUsageUpdatedPayload includes `support` and `source` alongside `usage` so downstream consumers know the data quality tier
- Codex adapter defensively returns empty array when `tokenUsage` is missing from the event payload, rather than emitting an event with empty/invalid data

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Normalization module ready for Claude Code and Gemini adapters (08-02)
- normalizeClaudeUsage and normalizeGeminiUsage exported and ready for import
- ThreadTokenUsageUpdatedPayload typed contract ready for all three adapters

## Self-Check: PASSED

All created files exist, all commits found, all exports verified.

---
*Phase: 08-provider-normalization*
*Completed: 2026-03-13*
