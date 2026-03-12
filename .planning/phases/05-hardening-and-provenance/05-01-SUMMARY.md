---
phase: 05-hardening-and-provenance
plan: 01
subsystem: ui, api, server
tags: [provenance, validation, fingerprint, collapsible, react-query, effect]

# Dependency graph
requires:
  - phase: 04-claude-code-import-and-native-resume
    provides: ThreadExternalLink persistence, native resume infrastructure, ProviderCommandReactor
provides:
  - Shared computeFingerprint utility for scanner deduplication and link validation
  - HistoryImportValidateLinkResult contract schema
  - Server-side validateLink method with file stat and fingerprint recomputation
  - WS handler for historyImport.validateLink (replacing Phase 5 stub)
  - React Query threadLinks query and validateLink mutation options
  - useThreadExternalLink hook with lazy background validation
  - ProvenanceCard collapsible component with validation badge and metadata
  - ChatView integration rendering provenance bar for imported threads
affects: [05-02-PLAN, 05-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Shared fingerprint utility extracted from duplicate scanner code
    - Lazy background validation pattern (1-hour threshold) via useEffect + mutation
    - Collapsible provenance card with status badge mapping

key-files:
  created:
    - apps/server/src/historyImport/fingerprint.ts
    - apps/web/src/hooks/useThreadExternalLink.ts
    - apps/web/src/components/ProvenanceCard.tsx
  modified:
    - apps/server/src/historyImport/Layers/CodexHistoryScanner.ts
    - apps/server/src/historyImport/Layers/ClaudeCodeHistoryScanner.ts
    - packages/contracts/src/historyImport.ts
    - packages/contracts/src/ipc.ts
    - apps/server/src/historyImport/Services/HistoryImportService.ts
    - apps/server/src/historyImport/Layers/HistoryImportService.ts
    - apps/server/src/wsServer.ts
    - apps/web/src/wsNativeApi.ts
    - apps/web/src/lib/historyImportReactQuery.ts
    - apps/web/src/components/ChatView.tsx

key-decisions:
  - "Cast ThreadId at React Query boundary using 'as ThreadId' for branded type compatibility"
  - "Used exactOptionalPropertyTypes-compliant union type for optional onContinueInProvider prop"
  - "scheduleComposerFocus reused for Continue in Provider button instead of raw querySelector"

patterns-established:
  - "Shared fingerprint utility: apps/server/src/historyImport/fingerprint.ts"
  - "Lazy background validation pattern: useEffect + shouldRevalidate(1h) + mutation guard"
  - "Validation status badge mapping: valid/missing/stale/invalid/unknown/importing"

# Metrics
duration: 13min
completed: 2026-03-12
---

# Phase 5 Plan 01: Link Validation and Thread Provenance Card Summary

**Shared fingerprint utility, server-side validateLink with file stat and fingerprint recomputation, and collapsible ProvenanceCard in ChatView with lazy background validation**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-12T18:08:35Z
- **Completed:** 2026-03-12T18:22:34Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- Extracted shared computeFingerprint utility from duplicate code in both scanners (CodexHistoryScanner and ClaudeCodeHistoryScanner)
- Implemented full validateLink vertical slice: contract schema, service interface, server implementation with file existence check and fingerprint recomputation, WS handler, client transport, React Query wiring
- Built ProvenanceCard collapsible component with validation status badge, metadata rows, Validate Link button, and conditional Continue in Provider button for native-resume threads
- Integrated ProvenanceCard into ChatView with lazy background validation on thread open (1-hour staleness threshold)

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared fingerprint utility, scanner refactoring, and contracts** - `1be401a3` (feat)
2. **Task 2: validateLink server implementation, WS handler, and client wiring** - `0367b429` (feat)
3. **Task 3: ProvenanceCard component, useThreadExternalLink hook, and ChatView integration** - `3158387d` (feat)

## Files Created/Modified
- `apps/server/src/historyImport/fingerprint.ts` - Shared computeFingerprint utility (SHA-256, head/tail sampling)
- `apps/server/src/historyImport/Layers/CodexHistoryScanner.ts` - Refactored to import shared fingerprint
- `apps/server/src/historyImport/Layers/ClaudeCodeHistoryScanner.ts` - Refactored to import shared fingerprint
- `packages/contracts/src/historyImport.ts` - Added HistoryImportValidateLinkResult schema
- `packages/contracts/src/ipc.ts` - Added validateLink to NativeApi.historyImport
- `apps/server/src/historyImport/Services/HistoryImportService.ts` - Added validateLink to HistoryImportServiceShape
- `apps/server/src/historyImport/Layers/HistoryImportService.ts` - Implemented validateLink with file stat + fingerprint check
- `apps/server/src/wsServer.ts` - Replaced validateLink stub with real implementation
- `apps/web/src/wsNativeApi.ts` - Added validateLink to WS transport
- `apps/web/src/lib/historyImportReactQuery.ts` - Added threadLinks query and validateLink mutation options
- `apps/web/src/hooks/useThreadExternalLink.ts` - Lazy-fetch hook with auto-validate on thread open
- `apps/web/src/components/ProvenanceCard.tsx` - Collapsible provenance card with badge and actions
- `apps/web/src/components/ChatView.tsx` - Integrated ProvenanceCard below header for imported threads

## Decisions Made
- Cast ThreadId at React Query boundary using `as ThreadId` for branded type compatibility (follows existing pattern in composerDraftStore.ts)
- Used `exactOptionalPropertyTypes`-compliant union type `(() => void) | undefined` for optional `onContinueInProvider` prop
- Reused `scheduleComposerFocus` for Continue in Provider button instead of raw `querySelector` -- leverages existing composer focus infrastructure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes incompatibility**
- **Found during:** Task 3 (ProvenanceCard integration)
- **Issue:** Optional prop `onContinueInProvider?: () => void` was incompatible with `exactOptionalPropertyTypes: true` when passing `undefined` conditionally
- **Fix:** Changed type to `onContinueInProvider?: (() => void) | undefined`
- **Files modified:** apps/web/src/components/ProvenanceCard.tsx
- **Verification:** typecheck passes
- **Committed in:** 3158387d (Task 3 commit)

**2. [Rule 1 - Bug] Fixed branded ThreadId type at React Query boundary**
- **Found during:** Task 2 (React Query options)
- **Issue:** `string` not assignable to branded `ThreadId` in query/mutation functions
- **Fix:** Added `as ThreadId` cast and imported `ThreadId` type
- **Files modified:** apps/web/src/lib/historyImportReactQuery.ts
- **Verification:** typecheck passes
- **Committed in:** 0367b429 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for type safety. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ProvenanceCard is ready for visual review in the running app
- validateLink infrastructure ready for Plan 02 (incremental import / link maintenance)
- Shared fingerprint utility available for any future fingerprint-dependent features

---
*Phase: 05-hardening-and-provenance*
*Completed: 2026-03-12*

## Self-Check: PASSED
- All 3 created files exist on disk
- All 3 task commits found in git history
