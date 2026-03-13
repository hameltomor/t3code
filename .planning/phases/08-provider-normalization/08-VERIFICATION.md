---
phase: 08-provider-normalization
verified: 2026-03-13T18:02:31Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 8: Provider Normalization Verification Report

**Phase Goal:** All three provider adapters emit typed `thread.token-usage.updated` events with canonical payloads, so the server pipeline has uniform input regardless of provider
**Verified:** 2026-03-13T18:02:31Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                              | Status     | Evidence                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Codex adapter emits `thread.token-usage.updated` with typed NormalizedTokenUsage payload, support="native"        | VERIFIED | `CodexAdapter.ts` line 704-720: imports `normalizeCodexUsage`, calls `normalizeCodexUsage(tokenUsage)`, sets `support: "native" as const, source: "provider-event" as const` |
| 2   | Claude Code adapter emits `thread.token-usage.updated` on result messages (derived-live) and compact_boundary     | VERIFIED | `ClaudeCodeAdapter.ts` line 1231-1252 (result) and lines 1319-1343 (compact_boundary): both use `support: "derived-live" as const, source: "sdk-usage" as const` |
| 3   | Gemini adapter emits `thread.token-usage.updated` from usageMetadata (derived-on-demand), countTokens never blocks | VERIFIED | `GeminiAdapter.ts` lines 262-278: emits in `completeTurn` from `ts.lastUsageMetadata`. No `countTokens` calls anywhere in the adapter |
| 4   | Typed normalization layer exists: three pure functions convert raw provider payloads into NormalizedTokenUsage     | VERIFIED | `tokenUsageNormalization.ts`: exports `normalizeCodexUsage`, `normalizeClaudeUsage`, `normalizeGeminiUsage` with full implementations |
| 5   | Cross-provider fixture tests verify normalization of real Codex, Claude, and Gemini payloads                      | VERIFIED | `tokenUsageNormalization.test.ts`: 9 test cases — 3 Codex, 2 Claude, 4 Gemini — all passing (513 total tests pass, 2 skipped) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                                       | Expected                                                                      | Status   | Details                                                                                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/server/src/provider/normalization/tokenUsageNormalization.ts`            | normalizeCodexUsage, normalizeClaudeUsage, normalizeGeminiUsage pure functions | VERIFIED | 107-line file; all three functions exported; imports `NormalizedTokenUsage` type from `@xbetools/contracts` |
| `packages/contracts/src/providerRuntime.ts`                                    | Typed ThreadTokenUsageUpdatedPayload with NormalizedTokenUsage, ContextStatusSupport, ContextStatusSource | VERIFIED | Lines 297-302: `usage: NormalizedTokenUsage`, `support: ContextStatusSupport`, `source: ContextStatusSource` — replaces former `Schema.Unknown` |
| `apps/server/src/provider/Layers/CodexAdapter.ts`                             | Codex adapter using normalizeCodexUsage and typed payload                     | VERIFIED | Lines 42-44: import; lines 704-720: usage with defensive null guard, `support: "native"`, `source: "provider-event"` |
| `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts`                         | Claude Code token usage emission with support=derived-live and compaction correlation | VERIFIED | Line 60: import; result emission lines 1231-1252; compact_boundary emission lines 1319-1343 |
| `apps/server/src/provider/Layers/GeminiAdapter.ts`                            | Gemini token usage emission with support=derived-on-demand from usageMetadata | VERIFIED | Line 57: import; `lastUsageMetadata` field on GeminiTurnState line 78; emission lines 262-278; saved at line 571 |
| `apps/server/src/provider/normalization/tokenUsageNormalization.test.ts`       | Cross-provider normalization fixture tests                                    | VERIFIED | 189-line file; imports all three functions; 9 test cases with realistic payloads and full assertions |

### Key Link Verification

| From                          | To                                  | Via                     | Status  | Details                                                                                         |
| ----------------------------- | ----------------------------------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `CodexAdapter.ts`             | `tokenUsageNormalization.ts`        | import normalizeCodexUsage | WIRED | Line 42: `import { normalizeCodexUsage, type CodexThreadTokenUsage } from "../normalization/tokenUsageNormalization.ts"` |
| `ClaudeCodeAdapter.ts`        | `tokenUsageNormalization.ts`        | import normalizeClaudeUsage | WIRED | Line 60: `import { normalizeClaudeUsage } from "../normalization/tokenUsageNormalization.ts"` |
| `GeminiAdapter.ts`            | `tokenUsageNormalization.ts`        | import normalizeGeminiUsage | WIRED | Line 57: `import { normalizeGeminiUsage } from "../normalization/tokenUsageNormalization.ts"` |
| `packages/contracts/src/providerRuntime.ts` | `packages/contracts/src/orchestration.ts` | import NormalizedTokenUsage, ContextStatusSupport, ContextStatusSource | WIRED | Lines 14-18: imports all three types; used at lines 298-300 in `ThreadTokenUsageUpdatedPayload` |
| `tokenUsageNormalization.test.ts` | `tokenUsageNormalization.ts`    | import all three normalization functions | WIRED | Lines 3-10: imports `normalizeCodexUsage`, `normalizeClaudeUsage`, `normalizeGeminiUsage` and all raw type interfaces |

### Requirements Coverage

| Requirement                                                                                                     | Status    | Notes                                                                        |
| --------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| Codex adapter emits typed canonical payload with support="native"                                               | SATISFIED | `normalizeCodexUsage` called, `support: "native"`, `source: "provider-event"` |
| Claude Code adapter emits on result messages and compact_boundary with support="derived-live"                   | SATISFIED | Both emission points implemented and wired                                    |
| Gemini adapter emits from usageMetadata with support="derived-on-demand", countTokens failures never block turns | SATISFIED | usageMetadata tracked on turn state, emitted in completeTurn; no countTokens calls |
| Typed normalization layer converts all three provider payloads into NormalizedTokenUsage                        | SATISFIED | Pure functions exist, ThreadTokenUsageUpdatedPayload fully typed              |
| Cross-provider fixture tests verify normalization                                                               | SATISFIED | 9 test cases, all passing                                                     |

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments, no stub implementations, no empty return bodies found in any modified files.

### Human Verification Required

None required. All observable truths are verifiable programmatically through code inspection and test execution.

## Build and Test Status

- `bun typecheck`: PASS — 7 packages, all successful (TS41/TS47 are linting suggestions, not errors)
- `bun lint`: PASS — 0 errors, 9 warnings (pre-existing)
- `bun run test` (apps/server): PASS — 513 tests passed, 2 skipped, 48 test files

## Commits Verified

All four commits from the SUMMARY are present in git history:
- `f42f23b5` — feat(08-01): add token usage normalization module and type ThreadTokenUsageUpdatedPayload
- `1623d225` — feat(08-01): wire Codex adapter to use normalizeCodexUsage with typed payload
- `96df8409` — feat(08-02): wire Claude Code and Gemini adapters for token usage emission
- `08f97db2` — test(08-02): add cross-provider normalization fixture tests

---

_Verified: 2026-03-13T18:02:31Z_
_Verifier: Claude (gsd-verifier)_
