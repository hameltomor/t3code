# Phase 5: Hardening and Provenance - Research

**Researched:** 2026-03-12
**Domain:** Link validation, thread provenance UI, lazy validation, thread list badges/filtering, partial-import handling, performance tuning
**Confidence:** HIGH (all findings derived from direct codebase analysis of the existing infrastructure built in Phases 1-4)

## Summary

Phase 5 completes the history import feature set by adding user-facing provenance information and operational hardening. The work spans three domains: (1) server-side link validation logic that checks source file existence and fingerprint freshness, (2) client-side provenance UI including a thread-view card and sidebar badges/filtering, and (3) partial-import detection and performance validation.

The existing infrastructure is well-prepared for this phase. The `ThreadExternalLinkEntry` schema already stores all provenance fields (providerName, originalCwd, importedAt, linkMode, validationStatus, lastValidatedAt, sourceFingerprint, sourcePath). The `HistoryImportValidateLinkInput` schema and `historyImport.validateLink` WS method name are already registered in contracts and wired as a stub in wsServer.ts. The `computeFingerprint` function exists in both scanners. The validation status enum (`valid | missing | stale | invalid | unknown`) is already defined. The main work is: implementing the validation logic, wiring the WS method, building the UI components, and adding the `validateLink` method to the NativeApi interface.

On the UI side, the `Badge` component (with `success`, `warning`, `error`, `info`, `outline` variants), `Card` component (with header/panel/footer slots), and `Collapsible` component are all available in the design system. The thread list in `Sidebar.tsx` already renders per-thread status pills and contextual badges (PR status, terminal status). The pattern for adding source badges and filtering is straightforward: use `providerThreadId !== null` as the signal that a thread is imported.

**Primary recommendation:** Implement link validation as a server-side Effect service method that checks file existence via `stat()` and recomputes fingerprints, then build the provenance card as a collapsible Card component in the ChatView header area. Use `useQuery` with lazy enabling (triggered on thread open) to fetch external link data without blocking the thread view render.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| effect | workspace | FileSystem for file stat, Schema for validation, Service/Layer architecture | Already used in all server-side import code |
| @tanstack/react-query | workspace | `useQuery` for lazy link validation fetch, `useMutation` for validate action | Already used for all WS data fetching |
| zustand | workspace | Thread store state (thread list filtering) | Already used as primary client state store |
| @xbetools/contracts | workspace | `ThreadExternalLink`, `HistoryImportValidationStatus`, `HistoryImportValidateLinkInput` schemas | Already defined in Phase 1 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | workspace | Icons for provenance card (Link, Shield, FolderOpen, Clock, etc.) | Already used throughout the UI |
| class-variance-authority | workspace | Badge variant styling | Already used in Badge component |
| @base-ui/react | workspace | Collapsible, Tooltip primitives | Already used in UI component library |
| node:fs/promises | built-in | `stat()` for file existence check | Already used in scanners for fingerprinting |
| node:crypto | built-in | SHA-256 for fingerprint recomputation | Already used in scanners |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `useQuery` for lazy validation | `useEffect` + manual fetch | useQuery provides caching, deduplication, staleness tracking, and refetch-on-focus for free |
| `providerThreadId !== null` for import detection | Fetch external link for every thread | providerThreadId is already on the read model -- no extra query needed for sidebar badge logic |
| Collapsible provenance card | Always-visible card | Collapsible respects screen real estate; imported threads may have many messages below the card |

**Installation:**
```bash
# No new packages needed -- all libraries already in workspace
```

## Architecture Patterns

### Recommended Project Structure
```
apps/server/src/
  historyImport/
    Layers/
      HistoryImportService.ts      # MODIFY: add validateLink method
    Services/
      HistoryImportService.ts      # MODIFY: add validateLink to interface
  persistence/
    Layers/
      ThreadExternalLinks.ts       # READ: existing update query for validationStatus/lastValidatedAt
  wsServer.ts                      # MODIFY: implement validateLink handler (replace stub)

apps/web/src/
  components/
    ProvenanceCard.tsx             # NEW: collapsible provenance card for thread view
    Sidebar.tsx                    # MODIFY: add source badge and filter tab
  hooks/
    useThreadExternalLink.ts       # NEW: lazy-fetch external link data for a thread
  lib/
    historyImportReactQuery.ts     # MODIFY: add validateLink mutation + listThreadLinks query

packages/contracts/src/
  ipc.ts                           # MODIFY: add validateLink to NativeApi interface
  historyImport.ts                 # READ: schemas already defined
```

### Pattern 1: Lazy Link Validation on Thread Open
**What:** When a user opens an imported thread, fetch the external link data and trigger background validation. The thread view renders immediately with cached data; the validation badge updates asynchronously when the result returns.
**When to use:** Every time an imported thread is opened in the ChatView.
**Example:**
```typescript
// Source: Pattern derived from existing useQuery usage in ChatView.tsx
// In ChatView or a child component:
function useThreadExternalLink(threadId: ThreadId) {
  const isImported = useThread(threadId)?.providerThreadId !== null;

  const linkQuery = useQuery({
    queryKey: ["historyImport", "threadLinks", threadId],
    queryFn: async () => {
      const api = ensureNativeApi();
      const links = await api.historyImport.listThreadLinks({ threadId });
      return links[0] ?? null; // Single link per thread
    },
    enabled: isImported,
    staleTime: 60_000, // Cache for 1 minute
  });

  return linkQuery;
}

// Lazy validation: trigger on first fetch, not on every render
const validateMutation = useMutation({
  mutationKey: ["historyImport", "validateLink", threadId],
  mutationFn: async () => {
    const api = ensureNativeApi();
    return api.historyImport.validateLink({ threadId });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: ["historyImport", "threadLinks", threadId],
    });
  },
});

// Trigger validation when link is loaded and stale
useEffect(() => {
  if (linkQuery.data && shouldRevalidate(linkQuery.data)) {
    validateMutation.mutate();
  }
}, [linkQuery.data]);
```

### Pattern 2: Server-Side Link Validation Logic
**What:** The validation method checks three things: (1) does the source file exist at `sourcePath`? (2) does the current file fingerprint match the stored `sourceFingerprint`? (3) is the fingerprint fresh (not stale)?
**When to use:** In `HistoryImportService.validateLink` and triggered via `historyImport.validateLink` WS method.
**Example:**
```typescript
// Source: Derived from existing computeFingerprint in CodexHistoryScanner.ts and ClaudeCodeHistoryScanner.ts
const validateLink = (input: { threadId: string }) =>
  Effect.gen(function* () {
    const maybeLink = yield* externalLinkRepo
      .getByThreadId({ threadId: input.threadId })
      .pipe(Effect.mapError((e) => new HistoryImportNotFoundError({ message: e.message })));

    if (Option.isNone(maybeLink)) {
      return yield* new HistoryImportNotFoundError({
        message: `No external link for thread ${input.threadId}`,
      });
    }
    const link = maybeLink.value;

    // 1. Check file exists
    const fileExists = yield* Effect.tryPromise({
      try: () => stat(link.sourcePath).then(() => true),
      catch: () => false,
    });

    if (!fileExists) {
      // Update status to "missing"
      yield* externalLinkRepo.upsert({
        ...link,
        validationStatus: "missing",
        lastValidatedAt: new Date().toISOString(),
      });
      return { validationStatus: "missing" as const, threadId: input.threadId };
    }

    // 2. Recompute fingerprint
    const currentFingerprint = yield* computeFingerprint(
      link.providerSessionId ?? link.threadId,
      link.sourcePath,
    ).pipe(Effect.catch(() => Effect.succeed(null)));

    const validationStatus =
      currentFingerprint === null
        ? "invalid"
        : currentFingerprint === link.sourceFingerprint
          ? "valid"
          : "stale";

    // 3. Update link
    yield* externalLinkRepo.upsert({
      ...link,
      validationStatus,
      lastValidatedAt: new Date().toISOString(),
    });

    return { validationStatus, threadId: input.threadId };
  }).pipe(Effect.withSpan("HistoryImportService.validateLink"));
```

### Pattern 3: Provenance Card as Collapsible in Thread Header
**What:** A collapsible card below the thread header that shows import metadata. Uses the existing `Card`, `Badge`, and `Collapsible` UI primitives.
**When to use:** Rendered in ChatView when the thread has `providerThreadId !== null`.
**Example:**
```typescript
// Source: Pattern derived from existing Card component usage
function ProvenanceCard({
  externalLink,
  onValidate,
  isValidating,
}: {
  externalLink: ThreadExternalLink;
  onValidate: () => void;
  isValidating: boolean;
}) {
  const [open, setOpen] = useState(false);

  const statusBadge = {
    valid: { variant: "success" as const, label: "Valid" },
    missing: { variant: "error" as const, label: "Source Missing" },
    stale: { variant: "warning" as const, label: "Source Changed" },
    invalid: { variant: "error" as const, label: "Invalid" },
    unknown: { variant: "outline" as const, label: "Not Validated" },
  }[externalLink.validationStatus];

  const providerLabel =
    externalLink.providerName === "codex" ? "Codex" : "Claude Code";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground border-b">
        <CollapsibleTrigger className="flex items-center gap-1.5">
          <LinkIcon className="size-3" />
          <span>Imported from {providerLabel}</span>
          <Badge variant={statusBadge.variant} size="sm">
            {statusBadge.label}
          </Badge>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <Card className="mx-4 my-2">
          <CardPanel className="text-xs space-y-1.5">
            <div>Provider: {providerLabel}</div>
            <div>Original CWD: {externalLink.originalCwd}</div>
            <div>Imported: {formatDate(externalLink.importedAt)}</div>
            <div>Link Mode: {externalLink.linkMode}</div>
            <div>Source: {externalLink.sourcePath}</div>
            {externalLink.lastValidatedAt && (
              <div>Last Validated: {formatDate(externalLink.lastValidatedAt)}</div>
            )}
          </CardPanel>
          <CardFooter className="gap-2">
            <Button size="sm" variant="outline" onClick={onValidate} disabled={isValidating}>
              {isValidating ? "Validating..." : "Validate Link"}
            </Button>
          </CardFooter>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

### Pattern 4: Thread Source Badge in Sidebar
**What:** A small badge next to imported threads in the sidebar showing the source provider.
**When to use:** In the thread list item rendering within Sidebar.tsx.
**Example:**
```typescript
// Source: Pattern derived from existing prStatus and terminalStatus badge rendering in Sidebar.tsx
// In the thread list item, after the title span:
{thread.providerThreadId && (
  <Badge variant="outline" size="sm" className="ml-auto shrink-0">
    {thread.providerThreadId.startsWith("codex:") ? "Codex" : "CC"}
  </Badge>
)}
```

### Pattern 5: Thread List Filtering by Source
**What:** A tab/toggle control in the sidebar that filters threads by "All" / "Native" / "Imported".
**When to use:** In the sidebar search/filter area.
**Example:**
```typescript
// Source: Pattern derived from useThreadSearch hook
// Add a sourceFilter state to the sidebar:
const [sourceFilter, setSourceFilter] = useState<"all" | "native" | "imported">("all");

// Filter threads before rendering:
const filteredBySource = useMemo(() => {
  if (sourceFilter === "all") return threads;
  if (sourceFilter === "imported") return threads.filter((t) => t.providerThreadId !== null);
  return threads.filter((t) => t.providerThreadId === null);
}, [threads, sourceFilter]);
```

### Anti-Patterns to Avoid
- **Blocking thread view on validation:** Never make the thread view wait for validation to complete. Render immediately with cached/stale data, update badge asynchronously.
- **Fetching external link for every thread in sidebar:** The sidebar can show hundreds of threads. Use `providerThreadId !== null` from the existing read model for the imported badge. Only fetch external link data when a thread is opened.
- **Deleting threads on validation failure:** A "missing" or "stale" source file does NOT invalidate the imported transcript. The thread data is already materialized into the XBE orchestration engine. Validation status is informational only.
- **Revalidating on every render:** Use `staleTime` on the query and a "should revalidate" check (e.g., lastValidatedAt > 1 hour ago) to avoid excessive file system checks.
- **Computing fingerprint synchronously in WS handler:** The fingerprint computation reads file head/tail bytes. Use the existing Effect-based `computeFingerprint` pattern with `Effect.tryPromise` to keep it non-blocking.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File existence check | Custom fs wrapper | `node:fs/promises` `stat()` in `Effect.tryPromise` | Single call, handles ENOENT cleanly |
| Fingerprint recomputation | New hash function | Copy/extract `computeFingerprint` from CodexHistoryScanner | Already tested, same algorithm (sessionId + fileSize + mtime + head/tail SHA-256) |
| Badge variants | Custom CSS classes | Existing `Badge` component with `success`/`warning`/`error`/`info`/`outline` variants | Consistent with design system |
| Collapsible panel | Custom accordion | Existing `Collapsible` from `@base-ui/react` | Already in the component library |
| Date formatting | Manual date string manipulation | `Intl.DateTimeFormat` or existing date utility | Locale-aware, handles timezone |
| Lazy data fetching | useEffect + fetch | `useQuery` with `enabled` flag | Built-in caching, deduplication, staleness |

**Key insight:** Almost everything needed for Phase 5 already exists in the codebase. The fingerprint logic, the validation status enum, the WS method stubs, the UI primitives, and the data schemas are all in place. The work is connecting these pieces together, not building from scratch.

## Common Pitfalls

### Pitfall 1: Blocking Thread View on Validation
**What goes wrong:** User opens an imported thread and sees a loading spinner while validation runs, instead of the thread content.
**Why it happens:** Validation is placed in the critical render path (e.g., before thread messages render).
**How to avoid:** Render the provenance card with the last known validation status immediately. Trigger validation in the background via a mutation. Update the badge when validation completes.
**Warning signs:** Thread open time increases noticeably for imported threads.

### Pitfall 2: Missing NativeApi Interface Update
**What goes wrong:** TypeScript compilation fails because `validateLink` is called on the NativeApi but not defined in the interface.
**Why it happens:** The WS method and request schema exist, but the NativeApi interface in `packages/contracts/src/ipc.ts` was not updated with `validateLink`.
**How to avoid:** Add `validateLink: (input: HistoryImportValidateLinkInput) => Promise<HistoryImportValidateLinkResult>` to the NativeApi `historyImport` section. Also define `HistoryImportValidateLinkResult` in `historyImport.ts` contracts.
**Warning signs:** Type errors in wsNativeApi.ts when adding the client call.

### Pitfall 3: N+1 Queries in Thread List
**What goes wrong:** For each imported thread in the sidebar, a separate `listThreadLinks` query fires, causing performance issues with many imported threads.
**Why it happens:** The sidebar tries to fetch external link data for every thread to show the validation status badge.
**How to avoid:** Use `providerThreadId !== null` for the sidebar badge (already on the thread object from the read model). Only fetch full external link data when a specific thread is opened in the ChatView. The sidebar shows a generic "Imported" badge, not the validation status.
**Warning signs:** Sidebar rendering becomes slow with 20+ imported threads.

### Pitfall 4: Fingerprint Mismatch Due to Missing Extract
**What goes wrong:** `computeFingerprint` exists as a private function in both `CodexHistoryScanner.ts` and `ClaudeCodeHistoryScanner.ts` but is not accessible from `HistoryImportService`.
**Why it happens:** The function is duplicated but not shared.
**How to avoid:** Extract `computeFingerprint` into a shared utility (e.g., `apps/server/src/historyImport/fingerprint.ts`) and import it from all three locations: CodexHistoryScanner, ClaudeCodeHistoryScanner, and HistoryImportService.validateLink.
**Warning signs:** Code duplication, or validation always returns "stale" because the fingerprint algorithm differs.

### Pitfall 5: Partial Import Detection Without State
**What goes wrong:** A thread was created via `thread.create` but message dispatch failed partway through. The thread exists in the orchestration read model but has fewer messages than expected. There is no way to detect this.
**Why it happens:** The current materializer dispatches messages sequentially. If a dispatch fails mid-way, the thread exists with partial data, and no "partial import" marker is set.
**How to avoid:** After thread creation and before message dispatch, mark the import as "in-progress" on the external link (e.g., `validationStatus: "importing"`). After all messages are dispatched, update to "valid". If the process fails, the status remains "importing" which serves as the partial-import indicator. The UI checks for this status and shows a warning badge.
**Warning signs:** Users see imported threads with unexpectedly few messages and no explanation.

### Pitfall 6: Source Filter Resets on Navigation
**What goes wrong:** User selects "Imported" filter, navigates to a thread, then the filter resets to "All".
**Why it happens:** The filter state is stored in component local state that unmounts on navigation.
**How to avoid:** Store the source filter preference in the persistent sidebar state (localStorage) alongside other sidebar preferences like expanded project CWDs.
**Warning signs:** Filter keeps resetting to "All" when switching threads.

### Pitfall 7: Performance Budget Requires Measurement, Not Assumption
**What goes wrong:** Phase claims performance targets are met but they were never measured.
**Why it happens:** NFR-6 specifies concrete targets (5s for 100 sessions, 2s preview, 10s for 500 messages) but no test infrastructure exists.
**How to avoid:** Add simple timing instrumentation to the validateLink, list, preview, and execute methods using `Effect.withSpan` (already used). For the performance plan, add console.time/timeEnd around key operations and validate against the NFR-6 targets manually. Consider adding benchmark test files.
**Warning signs:** No timing data collected during implementation.

## Code Examples

### Validate Link Server Implementation
```typescript
// Source: Derived from existing computeFingerprint + ThreadExternalLinkRepository patterns

// Add to HistoryImportServiceShape:
readonly validateLink: (
  input: HistoryImportValidateLinkInput,
) => Effect.Effect<HistoryImportValidateLinkResult, HistoryImportError>;

// Implementation in HistoryImportService layer:
const validateLink: HistoryImportServiceShape["validateLink"] = (input) =>
  Effect.gen(function* () {
    const maybeLink = yield* externalLinkRepo
      .getByThreadId({ threadId: input.threadId as string })
      .pipe(
        Effect.mapError(
          (cause) =>
            new HistoryImportNotFoundError({
              message: `Failed to query external link for thread ${input.threadId}`,
              cause,
            }),
        ),
      );

    const link = Option.getOrNull(maybeLink);
    if (!link) {
      return yield* new HistoryImportNotFoundError({
        message: `No external link for thread ${input.threadId}`,
      });
    }

    // Step 1: Check source file exists
    const fileExists = yield* Effect.tryPromise({
      try: () => stat(link.sourcePath).then(() => true as boolean),
      catch: () => false as boolean,
    });

    if (!fileExists) {
      const now = new Date().toISOString();
      yield* externalLinkRepo.upsert({
        ...link,
        validationStatus: "missing",
        lastValidatedAt: now,
      });
      return {
        threadId: input.threadId,
        validationStatus: "missing" as const,
        lastValidatedAt: now,
      };
    }

    // Step 2: Recompute fingerprint and compare
    const currentFingerprint = yield* recomputeFingerprint(
      link.providerSessionId ?? link.threadId,
      link.sourcePath,
    ).pipe(
      Effect.catch(() => Effect.succeed(null as string | null)),
    );

    let validationStatus: string;
    if (currentFingerprint === null) {
      validationStatus = "invalid";
    } else if (currentFingerprint === link.sourceFingerprint) {
      validationStatus = "valid";
    } else {
      validationStatus = "stale";
    }

    const now = new Date().toISOString();
    yield* externalLinkRepo.upsert({
      ...link,
      validationStatus,
      lastValidatedAt: now,
    });

    return {
      threadId: input.threadId,
      validationStatus,
      lastValidatedAt: now,
    };
  }).pipe(Effect.withSpan("HistoryImportService.validateLink"));
```

### WS Server Handler (Replace Stub)
```typescript
// Source: Existing pattern from historyImportExecute handler in wsServer.ts
case WS_METHODS.historyImportValidateLink: {
  const body = stripRequestTag(request.body);
  const result = yield* historyImportService.validateLink(body).pipe(
    Effect.mapError(
      (error) => new RouteRequestError({ message: error.message }),
    ),
  );
  return result;
}
```

### NativeApi Interface Addition
```typescript
// Source: Existing NativeApi historyImport section in packages/contracts/src/ipc.ts
historyImport: {
  list: (input: HistoryImportListInput) => Promise<HistoryImportConversationSummary[]>;
  preview: (input: HistoryImportPreviewInput) => Promise<HistoryImportConversationPreview>;
  execute: (input: HistoryImportExecuteInput) => Promise<HistoryImportExecuteResult>;
  validateLink: (input: HistoryImportValidateLinkInput) => Promise<HistoryImportValidateLinkResult>;
  listThreadLinks: (input: HistoryImportListThreadLinksInput) => Promise<ThreadExternalLink[]>;
};
```

### wsNativeApi Client Wiring
```typescript
// Source: Existing wsNativeApi.ts historyImport section
historyImport: {
  list: (input) => transport.request(WS_METHODS.historyImportList, input),
  preview: (input) => transport.request(WS_METHODS.historyImportPreview, input),
  execute: (input) => transport.request(WS_METHODS.historyImportExecute, input),
  validateLink: (input) => transport.request(WS_METHODS.historyImportValidateLink, input),
  listThreadLinks: (input) => transport.request(WS_METHODS.historyImportListThreadLinks, input),
},
```

### Shared Fingerprint Utility
```typescript
// Source: Extract from CodexHistoryScanner.ts (lines 47-98) and ClaudeCodeHistoryScanner.ts (lines 35-97)
// New file: apps/server/src/historyImport/fingerprint.ts

import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { Effect } from "effect";
import { HistoryImportScanError } from "./Errors.ts";

const SAMPLE_SIZE = 4096;

export function computeFingerprint(
  sessionId: string,
  filePath: string,
): Effect.Effect<string, HistoryImportScanError> {
  return Effect.tryPromise({
    try: async () => {
      const fileStat = await stat(filePath);
      const fileSize = fileStat.size;
      const mtimeMs = fileStat.mtimeMs;

      const headBuf = Buffer.alloc(Math.min(SAMPLE_SIZE, fileSize));
      const handle = await open(filePath, "r");
      try {
        await handle.read(headBuf, 0, headBuf.length, 0);

        let tailBuf = headBuf;
        if (fileSize > SAMPLE_SIZE) {
          tailBuf = Buffer.alloc(SAMPLE_SIZE);
          await handle.read(tailBuf, 0, SAMPLE_SIZE, fileSize - SAMPLE_SIZE);
        }

        const hash = createHash("sha256");
        hash.update(sessionId);
        hash.update(String(fileSize));
        hash.update(String(mtimeMs));
        hash.update(headBuf);
        hash.update(tailBuf);
        return hash.digest("hex");
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      new HistoryImportScanError({
        message: `Failed to compute fingerprint for ${filePath}`,
        cause,
      }),
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| validateLink stub returns error | Will be implemented with file stat + fingerprint check | Phase 5 | Enables provenance card and validation badges |
| No provenance UI | Provenance card + sidebar badges | Phase 5 | Users see import origin metadata |
| No thread filtering by source | "All" / "Native" / "Imported" filter | Phase 5 | Users can focus on specific thread types |
| No partial import detection | validationStatus "importing" marker | Phase 5 | Users see warning on incomplete imports |
| Fingerprint duplicated in two scanners | Shared utility module | Phase 5 | Single source of truth, validation can reuse |

**Deprecated/outdated:**
- The `historyImport.validateLink` stub in wsServer.ts must be replaced with the real implementation.
- The `NativeApi` interface is missing `validateLink` -- it must be added.
- The `HistoryImportValidateLinkResult` schema does not exist yet in contracts -- it must be created.

## Open Questions

1. **Should the provenance card be always visible or collapsible?**
   - What we know: The ChatView header area already has limited vertical space (52px on Electron). Adding a full card would push message content down significantly.
   - What's unclear: Whether users want the provenance info always visible or prefer to expand it on demand.
   - Recommendation: Use a compact collapsible trigger line (one line: "Imported from Codex [Valid]") that expands to show full provenance details. This minimizes vertical space usage while keeping the info accessible. Default to collapsed.

2. **How to handle the "importing" intermediate state for partial import detection?**
   - What we know: The current materializer sets `validationStatus: "valid"` at the end of import. If import fails mid-way, the status is "valid" because it was set on the external link upsert (step 5 of materializer), which happens AFTER message dispatch.
   - What's unclear: Whether we should add a two-phase status update (set "importing" before dispatch, update to "valid" after) or use a different detection mechanism.
   - Recommendation: The simplest approach is to check whether the thread's message count matches the expected count from the catalog entry. If the thread has a `providerThreadId` and an external link but significantly fewer messages than expected, show a "Partial Import" warning. This avoids modifying the materializer's existing flow. Alternatively, set `validationStatus: "importing"` before message dispatch and update to `"valid"` after -- but this requires modifying the materializer flow.

3. **Should validation run automatically on thread open, or only on manual trigger?**
   - What we know: The SC-2 requirement says "Opening an imported thread triggers lazy link validation that checks source path existence and fingerprint freshness, updating the validation badge without blocking the thread view."
   - Recommendation: Auto-validate on thread open, but throttle to at most once per hour per thread (check `lastValidatedAt`). Also provide a manual "Validate" button for on-demand validation.

4. **Where should the source filter live in the sidebar?**
   - What we know: The sidebar currently has a search bar at the top. There is no existing tab/toggle control for thread filtering.
   - What's unclear: Whether to add tabs (All/Native/Imported) or a dropdown filter or integrate into the existing search.
   - Recommendation: Add a small `ToggleGroup` (using the existing `toggle-group.tsx` component) below the search bar with three options: All / Native / Imported. This is compact and doesn't interfere with text search. Persist the selection in localStorage alongside other sidebar state.

## Sources

### Primary (HIGH confidence)
- **Codebase: `packages/contracts/src/historyImport.ts`** -- All existing schemas (HistoryImportValidateLinkInput, HistoryImportValidationStatus, ThreadExternalLink, HISTORY_IMPORT_WS_METHODS)
- **Codebase: `packages/contracts/src/ipc.ts`** -- NativeApi interface, missing validateLink method identified
- **Codebase: `packages/contracts/src/ws.ts`** -- WS method registration, request body schema union
- **Codebase: `apps/server/src/wsServer.ts`** -- validateLink stub at line 1117-1120, listThreadLinks handler at line 1122-1130
- **Codebase: `apps/server/src/historyImport/Layers/HistoryImportService.ts`** -- Current service implementation, no validateLink method
- **Codebase: `apps/server/src/historyImport/Services/HistoryImportService.ts`** -- Service interface, no validateLink method
- **Codebase: `apps/server/src/persistence/Services/ThreadExternalLinks.ts`** -- Repository interface with upsert, getByThreadId, listByThreadId
- **Codebase: `apps/server/src/persistence/Layers/ThreadExternalLinks.ts`** -- SQL queries for external link CRUD
- **Codebase: `apps/server/src/historyImport/Layers/CodexHistoryScanner.ts`** -- computeFingerprint implementation (lines 47-98)
- **Codebase: `apps/server/src/historyImport/Layers/ClaudeCodeHistoryScanner.ts`** -- Duplicate computeFingerprint (lines 35-97)
- **Codebase: `apps/server/src/historyImport/Layers/HistoryMaterializer.ts`** -- Thread creation and message dispatch flow, external link upsert at step 5
- **Codebase: `apps/web/src/components/Sidebar.tsx`** -- Thread list rendering, badge patterns, search/filter infrastructure
- **Codebase: `apps/web/src/components/ChatView.tsx`** -- ChatHeader structure, thread header area
- **Codebase: `apps/web/src/components/ui/badge.tsx`** -- Badge component with success/warning/error/info/outline variants
- **Codebase: `apps/web/src/components/ui/card.tsx`** -- Card/CardHeader/CardPanel/CardFooter components
- **Codebase: `apps/web/src/components/ui/collapsible.tsx`** -- Collapsible/CollapsibleTrigger/CollapsibleContent
- **Codebase: `apps/web/src/lib/historyImportReactQuery.ts`** -- Existing React Query patterns for history import
- **Codebase: `apps/web/src/wsNativeApi.ts`** -- WS transport client, missing validateLink call
- **Codebase: `apps/web/src/types.ts`** -- Thread interface with providerThreadId field
- **Codebase: `apps/web/src/store.ts`** -- Thread hydration from read model, providerThreadId mapping

### Secondary (MEDIUM confidence)
- **Codebase: `.planning/REQUIREMENTS.md`** -- FR-9 and NFR-6 acceptance criteria
- **Codebase: `.planning/ROADMAP.md`** -- Phase 5 success criteria and plan structure

### Tertiary (LOW confidence)
- None -- all findings derived from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use in the project
- Architecture: HIGH -- extends existing patterns (service/layer, useQuery, Badge, Card)
- Link validation logic: HIGH -- directly derived from existing computeFingerprint and ThreadExternalLink patterns
- Provenance card UI: HIGH -- uses existing UI primitives (Badge, Card, Collapsible, Tooltip)
- Thread list filtering: HIGH -- straightforward filter on providerThreadId already on read model
- Partial import handling: MEDIUM -- two approaches possible (message count check vs materializer modification), recommendation made but either could work
- Performance targets: MEDIUM -- NFR-6 targets are clear, but measurement approach needs to be implemented

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable domain -- internal architecture, no external dependencies to track)
