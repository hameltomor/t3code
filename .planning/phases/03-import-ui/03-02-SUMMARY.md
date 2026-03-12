---
phase: 03-import-ui
plan: 02
subsystem: ui
tags: [react, react-query, tanstack-router, toast, wizard, dialog, import]

# Dependency graph
requires:
  - phase: 03-import-ui
    plan: 01
    provides: "Import wizard shell with steps 1-2, React Query integration, wizard reducer, NativeApi historyImport transport"
  - phase: 02-codex-import-pipeline
    provides: "historyImport WS methods (list, preview, execute), server-side scan/preview/execute pipeline"
provides:
  - "PreviewStep (step 3) showing transcript messages, activities, warnings, truncation notice"
  - "ImportOptionsStep (step 4) with title, model, runtime mode, interaction mode, link mode fields"
  - "ResultStep (step 5) with success/error display, message counts, and thread navigation"
  - "Full wizard wiring: preview query, execute mutation, toast notification, thread navigation"
  - "Complete 5-step import wizard end-to-end flow"
affects: [04-claude-code-provider, 05-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mutation with local onSuccess/onError callbacks merged with mutationOptions from React Query module"
    - "Preview query synchronized to wizard state via useEffect watching query data"

key-files:
  created:
    - "apps/web/src/components/ImportWizard/steps/PreviewStep.tsx"
    - "apps/web/src/components/ImportWizard/steps/ImportOptionsStep.tsx"
    - "apps/web/src/components/ImportWizard/steps/ResultStep.tsx"
  modified:
    - "apps/web/src/components/ImportWizard/ImportWizard.tsx"

key-decisions:
  - "Used content-based keys (role+createdAt, kind+summary, warning text) instead of array indices for React list rendering to satisfy lint rules"
  - "Merged mutation callbacks (onSuccess/onError) locally in ImportWizard rather than in historyImportReactQuery module to keep toast/dispatch logic co-located with wizard state"

patterns-established:
  - "Wizard step component pattern completed: each step is a focused component receiving only relevant state slices and dispatch"

# Metrics
duration: 4min
completed: 2026-03-12
---

# Phase 03 Plan 02: Import Wizard Steps 3-5 with Preview, Options, Execute, and Navigation Summary

**Complete 5-step import wizard with transcript preview, configurable import options, execute mutation with toast notification, and navigation to created thread**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-12T10:42:11Z
- **Completed:** 2026-03-12T10:46:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- PreviewStep shows loading/error/data states with message samples (role labels, truncated text), collapsible activities, amber-styled warnings, and stats footer
- ImportOptionsStep renders all 5 configuration fields (title, model, runtime mode, interaction mode, link mode) with Select components and descriptive help text
- ResultStep displays import success with message/activity counts, link mode badge, and "Go to Thread" navigation
- ImportWizard fully wired with preview query (lazy on selectedSession), execute mutation with pending spinner, toast notification on success, and error handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PreviewStep and ImportOptionsStep components** - `b25a9563` (feat)
2. **Task 2: Create ResultStep, wire all steps in ImportWizard, and add toast notification** - `c188c38b` (feat)

## Files Created/Modified
- `apps/web/src/components/ImportWizard/steps/PreviewStep.tsx` - Step 3: transcript preview with loading/error states, messages, activities, warnings, stats
- `apps/web/src/components/ImportWizard/steps/ImportOptionsStep.tsx` - Step 4: import config form with title, model, runtime/interaction/link mode fields
- `apps/web/src/components/ImportWizard/steps/ResultStep.tsx` - Step 5: success/error result display with thread navigation
- `apps/web/src/components/ImportWizard/ImportWizard.tsx` - Wired preview query, execute mutation, toast, navigation, updated footer buttons

## Decisions Made
- Used content-based keys for React list rendering (e.g., `${message.role}-${message.createdAt}`) instead of array indices to satisfy the `no-array-index-key` lint rule while keeping keys stable
- Merged mutation onSuccess/onError callbacks locally in ImportWizard component rather than in the React Query module, keeping toast and dispatch logic co-located with the wizard state they affect

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full import wizard is now functional end-to-end for Codex provider
- Ready for Phase 4 (Claude Code provider) which will add another provider to the scan/import pipeline
- Phase 5 (Hardening) can wire the catalogUpdated push channel for real-time catalog refresh

## Self-Check: PASSED

All 4 files verified present. Both task commits (b25a9563, c188c38b) verified in git log.

---
*Phase: 03-import-ui*
*Completed: 2026-03-12*
