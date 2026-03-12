---
phase: 05-hardening-and-provenance
verified: 2026-03-12T18:33:41Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 5: Hardening and Provenance Verification Report

**Phase Goal:** Imported threads display their origin, link validation runs lazily on thread open, and the system surfaces partial imports and stale links without destroying data
**Verified:** 2026-03-12T18:33:41Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Thread view shows provenance card with provider origin, cwd, timestamp, link mode, validation status | VERIFIED | `ProvenanceCard.tsx` renders all six metadata fields; integrated in `ChatView.tsx` line 3666 |
| 2 | Opening an imported thread triggers lazy link validation (no blocking) | VERIFIED | `useThreadExternalLink.ts` runs `useQuery` + `useEffect` auto-validate with 1-hour threshold; ProvenanceCard only renders after data arrives |
| 3 | Thread list supports Native/Imported/All filter with source badges | VERIFIED | `Sidebar.tsx` has `ToggleGroup` filter (line 1246), `Badge` on imported threads (line 1492), both using `providerThreadId` |
| 4 | Source filter persists across navigation and page reload | VERIFIED | `localStorage.setItem("xbecode:source-filter", sourceFilter)` in `useEffect` (line 292) |
| 5 | Partially imported threads display warning badge (not silently deleted) | VERIFIED | `HistoryMaterializer.ts` upserts `validationStatus: "importing"` before dispatch (line 94); `ProvenanceCard.tsx` maps "importing" to `{ variant: "warning", label: "Partial Import" }` (line 32) |
| 6 | Catalog scan, preview, and import timing instrumentation exists | VERIFIED | `performance.now()` + `Effect.logInfo` on list/preview/execute/validateLink in `HistoryImportService.ts`; dispatch timing in `HistoryMaterializer.ts` |
| 7 | NFR-6 threshold documentation test exists with passing assertions | VERIFIED | `__tests__/performance.test.ts` has 5 assertions against `NFR6_THRESHOLDS` constants |
| 8 | `historyImport.validateLink` WS method returns real validation result (not stub error) | VERIFIED | `wsServer.ts` line 1117-1124 calls `historyImportService.validateLink(body)` — no stub |
| 9 | ProvenanceCard shows "Continue in Provider" button for native-resume threads | VERIFIED | `ProvenanceCard.tsx` line 127 conditionally renders button when `linkMode === "native-resume"` AND `onContinueInProvider` provided |
| 10 | `handleContinueInProvider` focuses composer input | VERIFIED | `ChatView.tsx` line 1408 calls `scheduleComposerFocus()` via existing focus infrastructure |
| 11 | Both scanners import `computeFingerprint` from shared utility | VERIFIED | `CodexHistoryScanner.ts` line 20 and `ClaudeCodeHistoryScanner.ts` line 21 both import from `../fingerprint.ts` |
| 12 | `NativeApi.historyImport.validateLink` exists in ipc.ts and wsNativeApi.ts | VERIFIED | `ipc.ts` line 208 declares interface; `wsNativeApi.ts` line 241 implements transport call |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/contracts/src/historyImport.ts` | `HistoryImportValidateLinkResult` schema | VERIFIED | Lines 149-154: struct with `threadId`, `validationStatus`, `lastValidatedAt` |
| `apps/server/src/historyImport/fingerprint.ts` | Shared `computeFingerprint` export | VERIFIED | Lines 17-57: exports `SAMPLE_SIZE` and `computeFingerprint` function |
| `apps/server/src/historyImport/Services/HistoryImportService.ts` | `validateLink` on service interface | VERIFIED | Lines 51-54: `validateLink` method in `HistoryImportServiceShape` |
| `apps/server/src/historyImport/Layers/HistoryImportService.ts` | `validateLink` implementation with file stat + fingerprint | VERIFIED | Lines 308-403: full implementation with `stat`, `computeFingerprint`, upsert |
| `apps/web/src/hooks/useThreadExternalLink.ts` | Lazy-fetch hook with auto-validate | VERIFIED | Lines 18-49: `useQuery` + `useEffect` + 1-hour threshold + `useMutation` |
| `apps/web/src/components/ProvenanceCard.tsx` | Collapsible card with badge and "Continue" action | VERIFIED | Lines 77-142: full `Collapsible` implementation |
| `apps/web/src/components/Sidebar.tsx` | Source badge + `ToggleGroup` filter with `sourceFilter` state | VERIFIED | Lines 287-293 (state/persist), 1246-1259 (ToggleGroup), 1492-1496 (badge) |
| `apps/server/src/historyImport/Layers/HistoryMaterializer.ts` | Two-phase upsert with `"importing"` before dispatch | VERIFIED | Line 94: `validationStatus: "importing"`; line 168: `validationStatus: "valid"` after dispatch |
| `apps/server/src/historyImport/__tests__/performance.test.ts` | NFR-6 threshold test with 5 assertions | VERIFIED | Lines 31-53: 5 `it()` blocks referencing `NFR6_THRESHOLDS` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ChatView.tsx` | `useThreadExternalLink.ts` | `useThreadExternalLink` hook call | WIRED | Line 620: `const { externalLink, isValidating, validate: validateExternalLink } = useThreadExternalLink(...)` |
| `useThreadExternalLink.ts` | `historyImportReactQuery.ts` | `historyImportThreadLinksQueryOptions` + `historyImportValidateLinkMutationOptions` | WIRED | Lines 7-9, 21-23, 27-29: both imported and called |
| `wsNativeApi.ts` | `wsServer.ts` | WS transport request for `validateLink` | WIRED | `wsNativeApi.ts` line 241 sends via `WS_METHODS.historyImportValidateLink`; `wsServer.ts` line 1117 routes it |
| `HistoryImportService.ts` (Layer) | `fingerprint.ts` | `import computeFingerprint` | WIRED | Line 29: `import { computeFingerprint } from "../fingerprint.ts"` |
| `CodexHistoryScanner.ts` | `fingerprint.ts` | shared fingerprint utility | WIRED | Line 20: `import { computeFingerprint } from "../fingerprint.ts"` |
| `ClaudeCodeHistoryScanner.ts` | `fingerprint.ts` | shared fingerprint utility | WIRED | Line 21: `import { computeFingerprint } from "../fingerprint.ts"` |
| `ChatView.tsx` | `ProvenanceCard.tsx` | conditional render below header | WIRED | Lines 3666-3675: `{externalLink && <ProvenanceCard ... />}` |

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR-9 (Thread Provenance Display) | SATISFIED | ProvenanceCard shows origin, cwd, timestamp, link mode, validation status; "Continue in Provider" for native-resume |
| NFR-6 (Performance targets: 5s scan, 2s preview, 10s import) | SATISFIED | Timing instrumentation on all methods; threshold documentation test with 5 passing assertions |

### Anti-Patterns Found

None — no TODO/FIXME/placeholder comments found in the key new files. No empty implementations or stub returns. The WS handler for `validateLink` was confirmed to call the real service method (no `RouteRequestError` stub).

**Notable non-blocker:** `HistoryImportValidationStatus` schema literal set (`"unknown" | "valid" | "missing" | "stale" | "invalid"`) does not include `"importing"`. The materializer writes "importing" to DB via `ThreadExternalLinkEntry` (which uses `Schema.String`). The WS response uses `Schema.Unknown` for the result payload, so "importing" reaches the client at runtime. `ProvenanceCard.tsx` handles "importing" in its switch — this path is reachable at runtime but not type-visible on the `ThreadExternalLink` contract type. Typecheck passes because the switch uses `string` as the parameter type. This is a minor contract/runtime gap but does not block the observable goals.

### Human Verification Required

#### 1. Provenance card visual appearance

**Test:** Import a Codex or Claude Code thread. Open it. Confirm a compact bar appears below the header with the provider name and a validation badge. Expand the bar and confirm all six metadata rows (Provider, Original CWD, Imported, Link Mode, Source, Last Validated) are visible.
**Expected:** Collapsible bar renders with correct badge color (green for "valid", amber for "stale", red for "missing").
**Why human:** Cannot verify visual rendering or Collapsible expand/collapse behavior programmatically.

#### 2. Lazy validation timing

**Test:** Open an imported thread where `lastValidatedAt` is null or older than 1 hour. Watch the badge. Within a few seconds it should update from "Not Validated"/"Stale" to a new status without any user interaction.
**Expected:** Badge updates automatically on thread open.
**Why human:** Cannot trigger real validation over a live WebSocket without a running server.

#### 3. "Continue in Provider" button for native-resume threads

**Test:** Import a thread with `linkMode === "native-resume"`. Open the provenance card (expand it). Click "Continue in Codex" or "Continue in Claude Code".
**Expected:** The composer/chat input area receives focus.
**Why human:** Focus behavior requires a live DOM.

#### 4. Source filter sidebar behavior

**Test:** Set source filter to "Imported", navigate to a thread, navigate back to the thread list.
**Expected:** Filter remains "Imported" (localStorage-persisted). Imported threads show "Codex" or "CC" badge.
**Why human:** Requires page-reload test for localStorage persistence.

#### 5. Partial import warning badge

**Test:** Simulate a failed import (e.g., by triggering a DB error mid-dispatch). Open the resulting thread's provenance card.
**Expected:** The badge shows "Partial Import" in amber/warning color.
**Why human:** Requires controlled failure injection to produce an "importing" status that is not overwritten.

---

## Gaps Summary

No gaps. All 12 must-have truths verified across all three plan sub-phases:

- **Plan 01:** Full validateLink vertical slice (contracts, server implementation, WS handler, client transport, React Query wiring, ProvenanceCard component, ChatView integration)
- **Plan 02:** Sidebar source badges and All/Native/Imported filter toggle; two-phase materializer upsert for partial-import detection
- **Plan 03:** NFR-6 performance instrumentation (timing on all four service methods + materializer) and threshold documentation test

The phase goal is achieved: imported threads display their origin (ProvenanceCard), link validation runs lazily on thread open (useThreadExternalLink hook), and the system surfaces partial imports (two-phase materializer + "Partial Import" badge) and stale links (fingerprint-based revalidation) without destroying data (data is preserved; only status is updated).

---

_Verified: 2026-03-12T18:33:41Z_
_Verifier: Claude (gsd-verifier)_
