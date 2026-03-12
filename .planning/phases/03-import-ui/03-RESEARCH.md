# Phase 3: Import UI - Research

**Researched:** 2026-03-12
**Domain:** React multi-step wizard, WebSocket RPC integration, @base-ui/react dialog/sheet primitives, Zustand state management, TanStack React Query
**Confidence:** HIGH

## Summary

Phase 3 builds a 5-step import wizard in the web app that consumes the history import server pipeline completed in Phase 2. The server already exposes fully functional WS methods (`historyImport.list`, `historyImport.preview`, `historyImport.execute`, `historyImport.listThreadLinks`) and all contract schemas exist in `packages/contracts/src/historyImport.ts`. The UI needs to: (1) add a `historyImport` namespace to the `NativeApi` interface and `wsNativeApi.ts` client, (2) build the wizard as a Dialog component with step-based state, (3) wire entry points in the project sidebar and empty-thread route, (4) manage local wizard state with a Zustand store (consistent with existing patterns), and (5) use existing UI primitives (Dialog, Badge, Select, ToggleGroup, Checkbox, ScrollArea, Toast).

The codebase already has every UI primitive needed for the wizard. No new npm dependencies are required. The Dialog component (from `@base-ui/react/dialog`) supports nested dialogs, scrollable panels, and programmatic open/close via `DialogCreateHandle`. The project already uses `@tanstack/react-query` for cached server data and `@tanstack/react-virtual` for large lists. Fuse.js handles client-side fuzzy search. The import wizard is fundamentally a local-state-driven multi-step flow where each step renders different content based on wizard state.

**Primary recommendation:** Build the import wizard as a full-screen Dialog with a `useReducer`-based step machine (not a Zustand store -- wizard state is ephemeral and dialog-scoped). Wire `NativeApi.historyImport` methods for WS calls. Use `@tanstack/react-query` for caching the catalog list. Use `@tanstack/react-virtual` for the session list only if there are more than ~100 sessions (unlikely in practice, but good for resilience). Place the wizard component at the layout level (`_chat.tsx` route) so it's accessible from both the sidebar and empty-thread state.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.0.0 | Component rendering, hooks | Already pinned in monorepo |
| @base-ui/react | ^1.2.0 | Dialog, Toggle, Select, Radio, Checkbox primitives | Already used for all UI components |
| @tanstack/react-query | ^5.90.0 | Server state cache for catalog list, preview, execute mutations | Already used across the app for all server data fetching |
| @tanstack/react-router | ^1.160.2 | Navigation to created thread after import | Already used for routing |
| zustand | ^5.0.11 | Dialog open/close state (wizard-open trigger from multiple entry points) | Already used for all client state |
| lucide-react | ^0.564.0 | Icons for provider badges, refresh, navigation | Already used throughout |
| fuse.js | ^7.1.0 | Client-side fuzzy search for session filtering | Already used in `useThreadSearch.ts` |
| @xbetools/contracts | workspace | `HistoryImport*` schemas, `WS_METHODS`, enums | Already has all needed types |
| @xbetools/shared/model | workspace | `getModelOptions`, `getDefaultModel` for import options | Already used in composer |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-virtual | ^3.13.18 | Virtualized session list rendering | Only if session list exceeds ~50 items for perf |
| effect (Schema) | catalog: | Schema decode for WS push payloads (catalogUpdated) | Already used in `wsNativeApi.ts` pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| useReducer for wizard state | Zustand store | useReducer is better -- wizard state is ephemeral, dialog-scoped, no persistence needed. Zustand adds unnecessary complexity for transient UI. |
| Dialog (full-screen) | Sheet (side panel) | Dialog centers content and scales better for a 5-step wizard with variable content. Sheet is better for single-purpose panels like NotificationCenter. |
| Fuse.js for session filter | Native .filter() | Fuse.js handles fuzzy matching of titles, cwds, providers; native filter only handles exact/substring. Fuse.js is already imported. |

**Installation:**
```bash
# No new packages needed -- everything is already in the dependency tree
```

## Architecture Patterns

### Recommended Project Structure
```
apps/web/src/
  components/
    ImportWizard/
      ImportWizard.tsx           # Dialog shell, step router, wizard reducer
      ImportWizardTrigger.tsx    # Reusable button/trigger for sidebar + empty state
      steps/
        ProviderSelectStep.tsx   # Step 1: Provider tabs + workspace info + refresh
        SessionListStep.tsx      # Step 2: Filterable session list with badges
        PreviewStep.tsx          # Step 3: Transcript preview with warnings
        ImportOptionsStep.tsx    # Step 4: Title, model, runtime, interaction, link mode
        ResultStep.tsx           # Step 5: Success result with thread link
      useImportWizardReducer.ts  # Wizard state machine (useReducer)
  lib/
    historyImportReactQuery.ts   # Query keys, queryOptions, mutationOptions for import
```

### Pattern 1: Wizard State Machine (useReducer)
**What:** A `useReducer`-based state machine that tracks current step, selected sessions, preview data, import options, and result. Each step transition is an explicit action dispatch.
**When to use:** For all wizard navigation and state transitions.
**Example:**
```typescript
// Source: existing codebase patterns (composerDraftStore, session-logic)
type WizardStep = "provider-select" | "session-list" | "preview" | "options" | "result";

interface WizardState {
  step: WizardStep;
  providerFilter: HistoryImportProvider | null;
  workspaceRoot: string;
  selectedCatalogId: string | null;
  preview: HistoryImportConversationPreview | null;
  importOptions: {
    title: string;
    model: string;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
    linkMode: HistoryImportLinkMode;
  };
  result: HistoryImportExecuteResult | null;
  error: string | null;
}

type WizardAction =
  | { type: "SET_PROVIDER_FILTER"; filter: HistoryImportProvider | null }
  | { type: "SELECT_SESSION"; catalogId: string; summary: HistoryImportConversationSummary }
  | { type: "SET_PREVIEW"; preview: HistoryImportConversationPreview }
  | { type: "UPDATE_OPTIONS"; options: Partial<WizardState["importOptions"]> }
  | { type: "SET_RESULT"; result: HistoryImportExecuteResult }
  | { type: "SET_ERROR"; error: string }
  | { type: "GO_BACK" }
  | { type: "RESET" };
```

### Pattern 2: NativeApi Extension (existing pattern)
**What:** Add `historyImport` namespace to `NativeApi` interface in `packages/contracts/src/ipc.ts` and implement in `apps/web/src/wsNativeApi.ts`.
**When to use:** For all WS method calls from the wizard.
**Example:**
```typescript
// Source: existing NativeApi pattern in packages/contracts/src/ipc.ts
// Add to NativeApi interface:
historyImport: {
  list: (input: HistoryImportListInput) => Promise<HistoryImportConversationSummary[]>;
  preview: (input: HistoryImportPreviewInput) => Promise<HistoryImportConversationPreview>;
  execute: (input: HistoryImportExecuteInput) => Promise<HistoryImportExecuteResult>;
  listThreadLinks: (input: HistoryImportListThreadLinksInput) => Promise<ThreadExternalLink[]>;
  onCatalogUpdated: (callback: (data: unknown) => void) => () => void;
};

// Source: existing wsNativeApi.ts pattern
// In createWsNativeApi():
historyImport: {
  list: (input) => transport.request(WS_METHODS.historyImportList, input),
  preview: (input) => transport.request(WS_METHODS.historyImportPreview, input),
  execute: (input) => transport.request(WS_METHODS.historyImportExecute, input),
  listThreadLinks: (input) => transport.request(WS_METHODS.historyImportListThreadLinks, input),
  onCatalogUpdated: (callback) =>
    transport.subscribe(WS_CHANNELS.historyImportCatalogUpdated, callback),
},
```

### Pattern 3: React Query for Import Data (existing pattern)
**What:** Query options and mutation options following existing `gitReactQuery.ts` and `providerReactQuery.ts` patterns.
**When to use:** For caching session list, preview data, and import mutations.
**Example:**
```typescript
// Source: existing gitReactQuery.ts pattern
export const historyImportQueryKeys = {
  all: ["historyImport"] as const,
  list: (workspaceRoot: string, providerFilter: string | null) =>
    ["historyImport", "list", workspaceRoot, providerFilter] as const,
  preview: (catalogId: string | null) =>
    ["historyImport", "preview", catalogId] as const,
};

export function historyImportListQueryOptions(
  workspaceRoot: string | null,
  providerFilter: HistoryImportProvider | null,
) {
  return queryOptions({
    queryKey: historyImportQueryKeys.list(workspaceRoot ?? "", providerFilter ?? "all"),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!workspaceRoot) throw new Error("Workspace root is required");
      return api.historyImport.list({
        workspaceRoot,
        ...(providerFilter ? { providerFilter } : {}),
      });
    },
    enabled: workspaceRoot !== null,
    staleTime: 30_000,
  });
}
```

### Pattern 4: Dialog with Programmatic Control (existing pattern)
**What:** Use a Zustand atom for wizard open/close state so both sidebar and empty-thread can trigger it. The Dialog component reads this state.
**When to use:** For the wizard Dialog open/close coordination.
**Example:**
```typescript
// Source: existing pattern from NotificationCenter (Sheet with isOpen state)
// But for cross-component trigger, use a minimal Zustand store:
import { create } from "zustand";

interface ImportWizardStore {
  isOpen: boolean;
  projectId: ProjectId | null;
  open: (projectId: ProjectId) => void;
  close: () => void;
}

export const useImportWizardStore = create<ImportWizardStore>((set) => ({
  isOpen: false,
  projectId: null,
  open: (projectId) => set({ isOpen: true, projectId }),
  close: () => set({ isOpen: false, projectId: null }),
}));
```

### Pattern 5: Session List with Already-Imported Detection
**What:** After fetching the session catalog, cross-reference with existing threads in the store to detect already-imported sessions. The orchestration read model's `threads` array includes `providerThreadId` (set during import), so matching by `providerConversationId` or `providerSessionId` from the catalog against the store's threads identifies previously imported sessions.
**When to use:** Step 2 -- session list rendering.
**Example:**
```typescript
// Compare catalog entries against thread external links
// The historyImport.listThreadLinks method can be called per-thread,
// but for batch detection, the simpler approach is:
// 1. Store a Set<string> of imported fingerprints from the thread store
// 2. Each catalog entry has a fingerprint field
// 3. Match fingerprints to show "already imported" badge
// Note: This requires fetching thread external links. Since there's no
// batch endpoint, the wizard should call listThreadLinks once and cache
// the result, or the server should expose a dedicated dedup-check endpoint.
// RECOMMENDATION: Use the HistoryImportService.list response which already
// has all the catalog data. For dedup detection, the execute method already
// rejects duplicates server-side via providerThreadId. For UI badges, store
// the imported catalogIds/fingerprints in local state after successful imports,
// and fetch existing thread links on wizard open.
```

### Anti-Patterns to Avoid
- **Global wizard state in Zustand:** Only the open/close + projectId should be global. All step-specific state (selectedCatalogId, preview data, import options) should live in the useReducer inside the Dialog component. This keeps the state lifecycle tied to the dialog lifecycle.
- **Loading full preview on session select:** The preview should be fetched lazily when the user navigates to Step 3, not when they click a session in the list. Use React Query's `enabled` flag keyed on the step.
- **Skipping server-side dedup:** Don't try to prevent the import button from showing based on client-side dedup alone. Always let the server reject duplicates. The client badge is informational, not authoritative.
- **Blocking the UI during import:** The execute call may take several seconds for large transcripts. Show a progress indicator (spinner + message count) rather than freezing the dialog.
- **Hand-rolling provider filter tabs:** Use the existing ToggleGroup component for provider tab selection. It supports single selection and keyboard navigation out of the box.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider tab selection | Custom radio buttons with divs | ToggleGroup from `~/components/ui/toggle-group` | Handles a11y, keyboard nav, visual state |
| Session list search | Custom filter with .includes() | Fuse.js (already imported in codebase) | Handles fuzzy matching on title, cwd, provider |
| Scrollable content | Overflow div with custom scrollbar | ScrollArea from `~/components/ui/scroll-area` | Consistent scrollbar styling, fade edges |
| Form select dropdowns | HTML select elements | Select from `~/components/ui/select` | Consistent popover styling, Base UI primitives |
| Toast notifications | Custom notification div | `toastManager.add()` from `~/components/ui/toast` | Already wired globally, supports types/actions |
| Badge styling | Custom span with colors | Badge from `~/components/ui/badge` | CVA variants for info/warning/success/error |
| Virtualized list | Manual windowing | `@tanstack/react-virtual` useVirtualizer | Already used in BranchToolbarBranchSelector |

**Key insight:** The codebase has a complete UI component library built on @base-ui/react primitives. The import wizard should compose these existing components, not create parallel implementations.

## Common Pitfalls

### Pitfall 1: Workspace Root Not Available at Wizard Open
**What goes wrong:** The wizard opens but has no workspace root to pass to `historyImport.list`.
**Why it happens:** The workspace root comes from the project's `cwd` field, which is only available from the `useStore()` projects array. If the wizard is opened from the empty-thread state before projects are loaded, `cwd` is null.
**How to avoid:** The wizard trigger must always pass a `projectId`. The wizard component resolves the `cwd` from the store's projects. If no projects exist, show a message ("No projects available") rather than making a broken API call. The `historyImportListQueryOptions` should have `enabled: workspaceRoot !== null`.
**Warning signs:** Empty session lists even when sessions exist on disk.

### Pitfall 2: Dialog State Leak Between Opens
**What goes wrong:** Closing and reopening the wizard shows stale data from the previous session.
**Why it happens:** React state persists across Dialog open/close if the component stays mounted.
**How to avoid:** Reset the wizard reducer on dialog open (dispatch `RESET` action in a `useEffect` triggered by `isOpen` changing to true). Alternatively, use `key={wizardOpenCounter}` to force full remount. The Dialog's `keepMounted` should be false (default) so the content unmounts on close.
**Warning signs:** Previously selected sessions appearing in a fresh wizard open.

### Pitfall 3: Race Condition Between Scan and List
**What goes wrong:** The user clicks "Refresh" to trigger a new scan, but `historyImport.list` returns stale results because the scan hasn't finished yet.
**Why it happens:** The `historyImport.list` method in Phase 2 triggers a scan and then returns the catalog. But if the scan is slow (many files), the response may be delayed. If the user clicks refresh again, two scans race.
**How to avoid:** Disable the refresh button while a list query is in-flight. Use React Query's `isFetching` state to show a loading indicator. The `refetch()` function from React Query handles deduplication of concurrent requests.
**Warning signs:** Duplicate entries in the session list, or entries disappearing and reappearing.

### Pitfall 4: Import Mutation Not Reflecting in Thread List
**What goes wrong:** After a successful import, the user clicks "Go to thread" but the thread doesn't exist in the sidebar.
**Why it happens:** The import creates a thread server-side via orchestration dispatch, which emits domain events. The web app's thread list updates from the `orchestration.domainEvent` push channel. If there's a timing gap, the thread may not be in the store yet.
**How to avoid:** After a successful execute mutation, wait briefly (or listen for the next orchestration domain event containing the new thread ID) before navigating. Alternatively, call `orchestration.getSnapshot()` to force a re-sync. The `syncServerReadModel` in the store will then include the new thread. Use the `useStore` thread selector with the returned `threadId` to confirm the thread exists before enabling the "Go to thread" link.
**Warning signs:** "Thread not found" errors when navigating after import.

### Pitfall 5: Missing NativeApi Methods Causing Runtime Errors
**What goes wrong:** The wizard calls `api.historyImport.list(...)` but gets a "historyImport is not defined" error.
**Why it happens:** The `NativeApi` interface in `packages/contracts/src/ipc.ts` does not yet have a `historyImport` namespace. The `wsNativeApi.ts` does not yet wire the transport calls.
**How to avoid:** Phase 3 Plan 01 MUST wire the NativeApi interface and wsNativeApi implementation BEFORE building any UI components that call these methods.
**Warning signs:** TypeScript compile errors about missing properties on NativeApi.

### Pitfall 6: Large Dialog on Mobile
**What goes wrong:** The 5-step wizard overflows on small screens.
**Why it happens:** The Dialog component uses a centered popup by default, which can be cramped on mobile.
**How to avoid:** Use the existing `bottomStickOnMobile` prop on DialogPopup (already implemented) and ensure each step has a responsive layout. Use `max-w-2xl` or `max-w-3xl` for the dialog on desktop, and full-width on mobile via the existing responsive breakpoints.
**Warning signs:** Content clipping or unscrollable areas on mobile devices.

## Code Examples

Verified patterns from the existing codebase:

### WS Method Call via NativeApi (existing pattern)
```typescript
// Source: apps/web/src/wsNativeApi.ts lines 131-178
// All WS calls follow this pattern:
historyImport: {
  list: (input) => transport.request(WS_METHODS.historyImportList, input),
  preview: (input) => transport.request(WS_METHODS.historyImportPreview, input),
  execute: (input) => transport.request(WS_METHODS.historyImportExecute, input),
  listThreadLinks: (input) => transport.request(WS_METHODS.historyImportListThreadLinks, input),
  onCatalogUpdated: (callback) =>
    transport.subscribe(WS_CHANNELS.historyImportCatalogUpdated, callback),
},
```

### React Query Options (existing pattern)
```typescript
// Source: apps/web/src/lib/gitReactQuery.ts lines 31-45
// Follow the exact same pattern for historyImport queries:
export function historyImportListQueryOptions(workspaceRoot: string | null) {
  return queryOptions({
    queryKey: historyImportQueryKeys.list(workspaceRoot ?? ""),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!workspaceRoot) throw new Error("Import list is unavailable.");
      return api.historyImport.list({ workspaceRoot });
    },
    enabled: workspaceRoot !== null,
    staleTime: 30_000,
  });
}
```

### Toast After Mutation (existing pattern)
```typescript
// Source: apps/web/src/components/Sidebar.tsx lines 890-921
// After import completes:
toastManager.add({
  type: "success",
  title: "Conversation imported",
  description: `Imported ${result.messageCount} messages and ${result.activityCount} activities.`,
});
```

### Dialog with Scrollable Panel (existing pattern)
```typescript
// Source: apps/web/src/components/ui/dialog.tsx
// The wizard uses Dialog with Header, Panel (scrollable), and Footer:
<Dialog open={isOpen} onOpenChange={handleClose}>
  <DialogPopup className="max-w-2xl" showCloseButton>
    <DialogHeader>
      <DialogTitle>Import Conversations</DialogTitle>
      <DialogDescription>Step {stepNumber} of 5</DialogDescription>
    </DialogHeader>
    <DialogPanel>
      {/* Step content renders here */}
    </DialogPanel>
    <DialogFooter>
      <Button variant="ghost" onClick={handleBack}>Back</Button>
      <Button onClick={handleNext}>Next</Button>
    </DialogFooter>
  </DialogPopup>
</Dialog>
```

### ToggleGroup for Provider Tabs (existing pattern)
```typescript
// Source: apps/web/src/components/ui/toggle-group.tsx
// For Step 1 provider filter:
<ToggleGroup type="single" value={providerFilter ?? "all"} onValueChange={handleProviderChange}>
  <Toggle value="all">All</Toggle>
  <Toggle value="codex">Codex</Toggle>
  <Toggle value="claudeCode">Claude Code</Toggle>
  <Toggle value="gemini">Gemini</Toggle>
</ToggleGroup>
```

### Navigation After Import (existing pattern)
```typescript
// Source: apps/web/src/components/NotificationCenter.tsx lines 375-399
// Navigate to the created thread:
void navigate({
  to: "/$threadId",
  params: { threadId: result.threadId },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Radix UI primitives | @base-ui/react primitives | Already migrated in this codebase | All new components must use @base-ui/react, not Radix |
| Global state for everything | Zustand for persistent, useReducer for ephemeral | Existing pattern | Wizard step state should be useReducer, not Zustand |
| Custom WS transport wrappers | NativeApi facade + WsTransport | Existing pattern | All server calls go through NativeApi, never direct transport |

**Deprecated/outdated:**
- Radix UI: Fully replaced by @base-ui/react in this codebase. Do not use any Radix imports.
- Direct WsTransport usage: All WS calls must go through NativeApi (which wraps WsTransport). Components never import WsTransport directly.

## Open Questions

1. **Already-imported detection strategy**
   - What we know: The server rejects duplicate imports via `providerThreadId` lookup in the orchestration read model. The `ThreadExternalLink` table stores `sourceFingerprint`.
   - What's unclear: There's no batch "check if these catalog IDs are already imported" endpoint. The `historyImport.listThreadLinks` takes a single threadId, not a catalog scan.
   - Recommendation: For Phase 3, use a pragmatic approach: fetch the thread list from the store, collect all providerThreadIds, and match against catalog entries' `providerConversationId`/`providerSessionId`. This avoids a new server endpoint. If a catalog entry's provider session matches an existing thread's providerThreadId, show the "already imported" badge. Accuracy is best-effort; the server is the authoritative dedup gate.

2. **catalogUpdated push channel not wired on server**
   - What we know: `WS_CHANNELS.historyImportCatalogUpdated` is defined in contracts and registered in ws.ts, but the server never pushes on this channel. No code in `apps/server/src` references `catalogUpdated`.
   - What's unclear: Whether the scan should push catalog updates in real-time or if polling (React Query refetch) is sufficient.
   - Recommendation: For Phase 3, rely on React Query's `refetch()` when the user clicks "Refresh" in the wizard. The push channel can be wired in Phase 5 (Hardening) for real-time catalog updates. This avoids scope creep.

3. **Dialog sizing for transcript preview**
   - What we know: Preview returns up to 50 messages and 20 activities. Each message can be multi-paragraph.
   - What's unclear: How tall the dialog should be to show a useful preview without forcing excessive scrolling.
   - Recommendation: Use `max-w-2xl` and `max-h-[80vh]` for the dialog. The DialogPanel component already handles overflow with ScrollArea. The preview step should show messages in a compact format (role + first 2-3 lines, expandable).

## Sources

### Primary (HIGH confidence)
- `packages/contracts/src/historyImport.ts` - All schema types verified (HistoryImportConversationSummary, HistoryImportConversationPreview, HistoryImportExecuteInput, HistoryImportExecuteResult, ThreadExternalLink, HistoryImportLinkMode, HistoryImportProvider, HistoryImportValidationStatus)
- `packages/contracts/src/ws.ts` - WS_METHODS and WS_CHANNELS registration verified for all historyImport methods
- `packages/contracts/src/ipc.ts` - NativeApi interface verified (missing historyImport namespace -- must be added)
- `apps/web/src/wsNativeApi.ts` - WS transport pattern verified (missing historyImport -- must be added)
- `apps/web/src/components/ui/dialog.tsx` - Dialog primitives verified (DialogPopup, DialogHeader, DialogPanel, DialogFooter, DialogTitle, DialogDescription)
- `apps/web/src/components/ui/sheet.tsx` - Sheet pattern verified (NotificationCenter reference)
- `apps/web/src/components/ui/toggle-group.tsx` - ToggleGroup verified for provider tabs
- `apps/web/src/components/ui/badge.tsx` - Badge variants verified (info, warning, success, error, outline)
- `apps/web/src/components/ui/select.tsx` - Select component verified for dropdown options
- `apps/web/src/components/ui/checkbox.tsx` - Checkbox verified for session selection
- `apps/web/src/components/ui/toast.tsx` - Toast system verified (toastManager.add pattern)
- `apps/web/src/store.ts` - Zustand store pattern verified (projects, threads, syncServerReadModel)
- `apps/web/src/lib/gitReactQuery.ts` - React Query pattern verified (queryOptions, mutationOptions, query keys)
- `apps/web/src/components/Sidebar.tsx` - Sidebar structure verified (project collapsible, thread list, context menu)
- `apps/web/src/routes/_chat.index.tsx` - Empty-thread state verified (minimal, needs import CTA)
- `apps/web/src/components/NotificationCenter.tsx` - Reference for Sheet-based panel with data fetching pattern
- `.planning/phases/02-codex-import-pipeline/02-VERIFICATION.md` - Phase 2 complete: 24/24 truths verified, all WS methods functional

### Secondary (MEDIUM confidence)
- `apps/web/src/hooks/useThreadSearch.ts` - Fuse.js usage pattern for session list filtering
- `apps/web/src/components/BranchToolbarBranchSelector.tsx` - useVirtualizer pattern for list virtualization

### Tertiary (LOW confidence)
- None -- all findings verified from codebase sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Everything is already in the dependency tree, no new packages needed
- Architecture: HIGH - All patterns directly observed in existing codebase code
- Pitfalls: HIGH - All pitfalls identified from direct code inspection (e.g., missing NativeApi methods, dialog state lifecycle)

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable -- no rapidly moving dependencies)
