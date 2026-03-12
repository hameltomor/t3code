---
phase: 03-import-ui
plan: 01
subsystem: ui
tags: [react, zustand, react-query, dialog, wizard, toggle-group, badge]

# Dependency graph
requires:
  - phase: 02-codex-import-pipeline
    provides: "historyImport WS methods, catalog/preview/execute server endpoints"
  - phase: 01-foundation-and-schema
    provides: "historyImport schemas, NativeApi interface, WS_METHODS constants"
provides:
  - "NativeApi.historyImport namespace with list/preview/execute/listThreadLinks"
  - "wsNativeApi WS transport bindings for all four historyImport methods"
  - "React Query integration (historyImportReactQuery.ts) with list/preview queryOptions and execute mutationOptions"
  - "Import wizard dialog shell with step-based reducer state machine"
  - "ProviderSelectStep (step 1) with provider filter ToggleGroup and workspace display"
  - "SessionListStep (step 2) with search, refresh, provider/linkMode/imported badges"
  - "ImportWizardTrigger with Zustand store for cross-component open/close"
  - "Sidebar context menu entry point (Import Conversations)"
  - "Empty-thread state entry point (Import existing chat)"
  - "providerThreadId on Thread interface and store projection"
affects: [03-import-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wizard state machine via useReducer with typed WizardAction discriminated union"
    - "Cross-component dialog triggering via Zustand store (useImportWizardStore)"
    - "historyImport React Query pattern following gitReactQuery.ts conventions"

key-files:
  created:
    - "apps/web/src/lib/historyImportReactQuery.ts"
    - "apps/web/src/components/ImportWizard/ImportWizard.tsx"
    - "apps/web/src/components/ImportWizard/ImportWizardTrigger.tsx"
    - "apps/web/src/components/ImportWizard/useImportWizardReducer.ts"
    - "apps/web/src/components/ImportWizard/steps/ProviderSelectStep.tsx"
    - "apps/web/src/components/ImportWizard/steps/SessionListStep.tsx"
  modified:
    - "packages/contracts/src/ipc.ts"
    - "apps/web/src/wsNativeApi.ts"
    - "apps/web/src/types.ts"
    - "apps/web/src/store.ts"
    - "apps/web/src/components/Sidebar.tsx"
    - "apps/web/src/routes/_chat.index.tsx"
    - "apps/web/src/components/ChatView.tsx"
    - "apps/web/src/store.test.ts"
    - "apps/web/src/worktreeCleanup.test.ts"

key-decisions:
  - "Added GO_TO_SESSION_LIST action to wizard reducer for explicit provider-select to session-list navigation"
  - "Used Zustand store (useImportWizardStore) for cross-component wizard triggering rather than prop drilling"
  - "providerThreadId added as required field on Thread interface (not optional) to match server read model"

patterns-established:
  - "ImportWizard step pattern: each step is a separate component receiving dispatch and relevant state slices"
  - "historyImport React Query follows gitReactQuery.ts conventions (ensureNativeApi, queryOptions, mutationOptions)"

# Metrics
duration: 7min
completed: 2026-03-12
---

# Phase 03 Plan 01: Import Wizard Transport, React Query, and Steps 1-2 Summary

**NativeApi historyImport transport layer with React Query integration, import wizard dialog shell with provider-select and session-list steps, triggered from sidebar context menu and empty-thread state**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-12T10:31:44Z
- **Completed:** 2026-03-12T10:38:59Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments
- NativeApi.historyImport namespace with list/preview/execute/listThreadLinks methods wired to WS transport
- React Query integration providing list/preview queryOptions and execute mutationOptions following gitReactQuery.ts pattern
- Import wizard dialog with 5-step reducer state machine (steps 3-5 placeholder for plan 03-02)
- Step 1 (ProviderSelectStep) with provider filter ToggleGroup (All/Codex/Claude Code/Gemini) and workspace root display
- Step 2 (SessionListStep) with search filter, refresh button, and rich badges (provider, link mode, message count, already-imported)
- Two entry points: sidebar project context menu "Import Conversations" and empty-thread state "Import existing chat"

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire NativeApi historyImport transport and React Query integration** - `0fdcda40` (feat)
2. **Task 2: Build import wizard dialog shell with steps 1-2 and entry points** - `3a1b1e20` (feat)

## Files Created/Modified
- `packages/contracts/src/ipc.ts` - Added historyImport namespace to NativeApi interface with type imports
- `apps/web/src/wsNativeApi.ts` - Added historyImport WS transport bindings for all four methods
- `apps/web/src/lib/historyImportReactQuery.ts` - Query keys, list/preview queryOptions, execute mutationOptions
- `apps/web/src/types.ts` - Added providerThreadId to Thread interface
- `apps/web/src/store.ts` - Added providerThreadId to syncServerReadModel thread projection
- `apps/web/src/components/ImportWizard/useImportWizardReducer.ts` - Wizard state machine with typed actions
- `apps/web/src/components/ImportWizard/ImportWizard.tsx` - Dialog shell with step router and providerThreadId set
- `apps/web/src/components/ImportWizard/ImportWizardTrigger.tsx` - Zustand store and trigger button
- `apps/web/src/components/ImportWizard/steps/ProviderSelectStep.tsx` - Provider filter tabs and workspace info
- `apps/web/src/components/ImportWizard/steps/SessionListStep.tsx` - Session list with badges and search
- `apps/web/src/components/Sidebar.tsx` - Added "Import Conversations" context menu item and wizard rendering
- `apps/web/src/routes/_chat.index.tsx` - Added "Import existing chat" button in empty-thread view
- `apps/web/src/components/ChatView.tsx` - Added providerThreadId to local draft thread builder
- `apps/web/src/store.test.ts` - Added providerThreadId to test thread factory
- `apps/web/src/worktreeCleanup.test.ts` - Added providerThreadId to test thread factory

## Decisions Made
- Added `GO_TO_SESSION_LIST` action to wizard reducer for explicit forward navigation from provider-select to session-list, since the original plan's reducer didn't have a direct forward navigation action
- Used Zustand store (useImportWizardStore) for cross-component wizard triggering, enabling both sidebar context menu and empty-thread state to open the wizard without prop drilling
- Made providerThreadId a required (non-optional) field on Thread interface to match the server read model's always-present (defaulted to null) behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing providerThreadId in ChatView, store.test, worktreeCleanup.test**
- **Found during:** Task 2 (adding providerThreadId to Thread interface)
- **Issue:** Adding providerThreadId as required to Thread interface broke three files that construct Thread objects without it
- **Fix:** Added `providerThreadId: null` to thread object literals in ChatView.tsx (buildLocalDraftThread), store.test.ts (makeThread), and worktreeCleanup.test.ts (makeThread)
- **Files modified:** apps/web/src/components/ChatView.tsx, apps/web/src/store.test.ts, apps/web/src/worktreeCleanup.test.ts
- **Verification:** `bun typecheck` passes with zero errors
- **Committed in:** 3a1b1e20 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix necessary for type correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Steps 1-2 complete, ready for plan 03-02 to implement steps 3-5 (preview, import options, result)
- React Query integration ready for preview/execute consumption
- Wizard reducer already has actions for SET_PREVIEW, GO_TO_OPTIONS, UPDATE_OPTIONS, SET_RESULT

---
*Phase: 03-import-ui*
*Completed: 2026-03-12*
