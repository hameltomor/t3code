---
phase: 05-hardening-and-provenance
plan: 02
subsystem: ui, server
tags: [react, sidebar, toggle-group, badge, localStorage, history-import, partial-import]

# Dependency graph
requires:
  - phase: 03-import-ui
    provides: Sidebar thread rendering with providerThreadId field on Thread interface
  - phase: 04-claude-code-import-and-native-resume
    provides: providerThreadId populated on imported threads with provider prefix
provides:
  - Source badges (Codex/CC) on imported threads in sidebar
  - All/Native/Imported toggle filter for thread list
  - localStorage-persisted source filter preference
  - Two-phase import status tracking (importing -> valid) in HistoryMaterializer
affects: [05-03, provenance-card, thread-list-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "base-ui ToggleGroup with array-based value prop for single selection"
    - "providerThreadId prefix-based provider detection (codex: vs claudeCode:)"
    - "Two-phase external link upsert for partial-import detection"

key-files:
  created: []
  modified:
    - apps/web/src/components/Sidebar.tsx
    - apps/server/src/historyImport/Layers/HistoryMaterializer.ts

key-decisions:
  - "Used base-ui ToggleGroup (array value API) instead of radix-style single-value API"
  - "Source detection via providerThreadId prefix avoids N+1 external link queries"
  - "Importing upsert before dispatch loop enables partial-import detection without extra columns"

patterns-established:
  - "Source filter pattern: localStorage key xbecode:source-filter with ToggleGroup UI"
  - "Two-phase upsert: importing -> valid lifecycle for import status tracking"

# Metrics
duration: 11min
completed: 2026-03-12
---

# Phase 5 Plan 2: Source Badges, Filtering, and Partial-Import Detection Summary

**Sidebar source badges (Codex/CC) with All/Native/Imported toggle filter, and two-phase import status tracking in materializer**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-12T18:08:46Z
- **Completed:** 2026-03-12T18:20:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Imported threads show "Codex" or "CC" badge in sidebar based on providerThreadId prefix
- All/Native/Imported toggle group filters thread list by source, persisted in localStorage
- HistoryMaterializer now sets validationStatus "importing" before dispatch, "valid" after -- partial imports are detectable
- Search filter and source filter work together (both apply simultaneously)

## Task Commits

Each task was committed atomically:

1. **Task 1: Source badge and source filter in Sidebar** - `e3d3b28e` (feat)
2. **Task 2: Partial-import detection in HistoryMaterializer** - `172cc184` (feat)

## Files Created/Modified
- `apps/web/src/components/Sidebar.tsx` - ToggleGroup source filter, source badge on imported threads, source-based thread filtering
- `apps/server/src/historyImport/Layers/HistoryMaterializer.ts` - Two-phase upsert with "importing" status before dispatch

## Decisions Made
- Used base-ui ToggleGroup with array-based `value` prop and `onValueChange` (not radix-style single value) -- matches the actual component API in the codebase
- Source detection uses `providerThreadId` prefix (`codex:` -> Codex, otherwise -> CC) to avoid N+1 queries for external link data
- `"importing"` upsert inserted between thread creation and message dispatch; existing `"valid"` upsert after dispatch left unchanged
- Badge uses `size="sm"` variant with inline height/text override for compact sidebar display

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing typecheck error in wsNativeApi.ts**
- **Found during:** Task 1 verification (bun typecheck)
- **Issue:** Uncommitted changes from 05-01 plan added `validateLink` to IPC contract but `wsNativeApi.ts` client was missing the method, causing TS2741 error
- **Fix:** Added `validateLink` method to wsNativeApi historyImport client (was already committed by previous agent in a separate commit 0367b429)
- **Files modified:** apps/web/src/wsNativeApi.ts (already committed)
- **Verification:** `bun typecheck` passes with 0 errors across all packages
- **Committed in:** Part of pre-existing commit 0367b429

**2. [Rule 3 - Blocking] Adapted ToggleGroup API to base-ui (not radix)**
- **Found during:** Task 1 implementation
- **Issue:** Plan described radix-style ToggleGroup API (`type="single"`, `value="string"`, `onValueChange(string)`). Actual base-ui API uses `value={["string"]}` (array), `onValueChange(string[])`, and no `type` prop
- **Fix:** Used correct base-ui API with array value, array onValueChange, and Toggle component (exported as ToggleGroupItem)
- **Files modified:** apps/web/src/components/Sidebar.tsx
- **Verification:** `bun typecheck` and `bun lint` pass
- **Committed in:** e3d3b28e (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for correct compilation. No scope creep.

## Issues Encountered
None beyond the deviations noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Source badges and filter provide the UI foundation for provenance-aware thread list
- Two-phase import status enables Plan 03 (provenance card) to detect and warn about partial imports
- All `must_haves` truths verified: source badges shown, toggle filter works, filter persists, partial imports detectable

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 05-hardening-and-provenance*
*Completed: 2026-03-12*
