# Project Research Summary

**Project:** Session Context Status Tracking
**Domain:** Real-time token usage tracking, context window monitoring, multi-provider normalization, UI status visualization
**Researched:** 2026-03-13
**Confidence:** HIGH

## Executive Summary

XBE Code is adding a session context status feature that shows users how much of the active model's context window is consumed. The feature is a full vertical slice: three provider adapters need to emit normalized token usage events, a new projection persists that data to SQLite and hydrates it onto the read model, and the web UI renders a minimal badge in the composer footer. Research is grounded entirely in direct codebase inspection, which gives unusually high confidence across all four research areas -- there are no speculative technology choices, only verified integration points.

The recommended approach follows the existing event-sourced orchestration pipeline without deviation. Token usage flows as provider runtime events through `ProviderRuntimeIngestion`, which normalizes them into a canonical `OrchestrationThreadContextStatus` schema and dispatches an internal `thread.context-status.set` command to the orchestration engine. A new projector persists this to a dedicated `projection_thread_context_status` SQLite table, and `ProjectionSnapshotQuery` hydrates it onto every `OrchestrationThread` for WebSocket push to the Zustand store. Zero new npm packages are required on either server or web.

The primary risks are: (1) Codex already emits token usage events but they are currently dropped by `ProviderRuntimeIngestion`; Claude Code and Gemini do not emit them at all and must be modified first. (2) The existing `usage: Schema.Unknown` on `ThreadTokenUsageUpdatedPayload` must be typed and normalized before building any downstream logic or silent data corruption is guaranteed. (3) Context utilization percentage depends on an accurate model context window registry -- hardcoded limits are the right approach, but the registry must use resolved model slugs and handle model rerouting mid-session.

---

## Key Findings

### Recommended Stack

No new dependencies are required. The server has `effect` (Ref, PubSub, Schema, HashMap), `@effect/sql-sqlite-bun`, and all three provider SDKs already installed. The web has `zustand`, `lucide-react`, and `tailwindcss` which are sufficient for the badge and progress bar. Adding charting libraries, token counting packages, or Radix UI progress components would be over-engineering.

The one new file at the shared package level is `packages/shared/src/contextWindow.ts`, which provides `resolveMaxContextTokens(modelSlug, providerReportedMax?)` as a pure function with a static registry and a null fallback for unknown models. This belongs in `packages/shared` (not `packages/contracts`) because it contains runtime logic.

**Core technologies:**
- `effect` Schema: typed canonical token usage schema in `packages/contracts` replacing `usage: Schema.Unknown` -- all downstream consumers gain type safety at zero cost
- `@effect/sql-sqlite-bun`: new `projection_thread_context_status` table for snapshot persistence -- follows established projection repository pattern
- `zustand`: extend existing `Thread` type with `contextStatus: ThreadContextStatus | null` -- push-based update, no React Query needed
- `lucide-react` + Tailwind + existing `Badge`/`Tooltip` components: all UI primitives verified present in `apps/web/src/components/ui/`

### Expected Features

Research on competitor tools (Cursor, Windsurf, Claude Code CLI, CodexMonitor) establishes the feature baseline. Cursor removed their context indicator and users revolted; this is non-negotiable table stakes.

**Must have (table stakes):**
- Context percentage badge in composer footer with threshold-based color coding (neutral <70%, watch 70-85%, warning 85-95%, danger >=95%)
- Graceful degradation for unknown/absent data -- show "Context unknown," never display fabricated percentages
- Projection-backed persistence -- context status survives WebSocket reconnect and page refresh, consistent with all other thread state
- Compaction event display -- "Compacted recently" badge state so users understand why the agent may have forgotten context
- Multi-provider normalization -- Codex (native push events), Claude Code (derived from SDK result messages), Gemini (derived from `usageMetadata`)

**Should have (competitive differentiators):**
- Unified multi-provider context view -- no competitor normalizes context status across Codex, Claude Code, and Gemini; this is XBE Code's unique position
- Per-provider data source metadata (`support: "native" | "derived-live" | "derived-on-demand"`) stored in projection for power user transparency
- Token breakdown in tooltip (input/output/cache/reasoning) -- store data in projection from day one, rendering deferred to P2

**Defer (v2+):**
- Display mode preference setting (minimal badge vs full pill) -- architectural support needed but settings UI is separate scope
- Adaptive notification toasts at configurable thresholds -- requires notification infrastructure not yet built
- Compaction history tooltip with exact timestamps -- data model stores `lastCompactedAt`, UI rendering is later

### Architecture Approach

The feature integrates as a new projection domain into the existing event-sourced orchestration pipeline. All data flows through the canonical path: adapter emits `thread.token-usage.updated` -> `ProviderRuntimeIngestion` normalizes and dispatches `thread.context-status.set` -> engine persists `thread.context-status-set` event -> `threadContextStatus` projector upserts to `projection_thread_context_status` -> `ProjectionSnapshotQuery` hydrates `contextStatus` onto each `OrchestrationThread` -> WebSocket push -> `syncServerReadModel` maps to `Thread.contextStatus` -> `ContextStatusIndicator` renders in composer footer. The context status projector is deliberately excluded from `REQUIRED_SNAPSHOT_PROJECTORS` to avoid blocking snapshot delivery on high-frequency token updates.

**Major components:**
1. `packages/contracts/src/orchestration.ts` -- new `OrchestrationThreadContextStatus` schema, `ThreadContextStatusSetCommand`, `thread.context-status-set` event type added to existing unions
2. `packages/shared/src/contextWindow.ts` -- static `resolveMaxContextTokens()` registry with null fallback, shared by server and web
3. `apps/server/src/persistence/Services+Layers/ProjectionThreadContextStatus.ts` -- repository for `projection_thread_context_status` SQLite table, follows `ProjectionThreadSessions` pattern exactly
4. `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` -- handles `thread.token-usage.updated`, normalizes via `normalizeTokenUsage()`, dispatches command (extend existing, do not add new Effect service)
5. `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` -- new `threadContextStatus` projector with session lifecycle cleanup
6. `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` -- `contextStatus` hydration added to snapshot assembly
7. `ClaudeCodeAdapter` and `GeminiAdapter` -- add `thread.token-usage.updated` emission; `CodexAdapter` already emits correctly
8. `apps/web/src/components/ChatView.tsx` -- new `ContextStatusIndicator` component placed in composer footer left-side control group

### Critical Pitfalls

1. **`Schema.Unknown` usage trap** -- The existing `ThreadTokenUsageUpdatedPayload.usage` is untyped. Any code that reads usage fields without first decoding through a typed schema will silently produce `undefined`/`NaN` across providers. Define `CodexTokenUsage`, `ClaudeCodeTokenUsage`, `GeminiTokenUsage` schemas plus a `CanonicalTokenUsage` normalizer before writing any projection logic. Detection: grep for `payload.usage` without a prior `Schema.decode` call.

2. **Provider emission asymmetry** -- Codex emits `thread.token-usage.updated` natively but it is currently dropped by `ProviderRuntimeIngestion` (`default: break` at line 497). Claude Code and Gemini emit nothing at all. Building the projection before fixing all three adapters produces a feature that works for one provider and shows zeros for others. All three adapters must emit the canonical event before the projection is built.

3. **Compaction resets context, accumulated usage does not** -- Session-cumulative token counters never decrease, but after compaction the model is working from a much smaller context. Showing accumulated tokens as "context used" displays "nearly full" when the model has headroom. Track "estimated current context occupancy" separately from "session cumulative tokens" and show a "Compacted" uncertainty indicator after compaction events.

4. **Stale projection after session restart or reconnect** -- If context status is stored independently of the session object, old session data leaks into new sessions. Tie context status to the `session` lifecycle: on `session.exited` and new `session.started`, explicitly clear/reset context status. Treat `session === null` as "no context data available," not "0 tokens."

5. **Model limit registry aliasing mismatches** -- The registry must use the same resolved slug that `resolveModelSlugForProvider` returns. If the registry uses raw user input ("opus") and the alias resolver produces "claude-opus-4-6", the lookup fails silently. Also handle `model.rerouted` events from Codex (CodexAdapter line 1053), which change the effective model and its limit mid-session.

---

## Implications for Roadmap

Research identifies a clear 5-phase dependency chain. Each phase gates the next. Phases 2 and 4 can be developed in parallel once Phase 1 completes.

### Phase 1: Schema Foundation and Contract Types
**Rationale:** All downstream layers (projection, adapters, web store, UI) depend on the canonical `OrchestrationThreadContextStatus` schema. Building anything else before this is defined creates rework. This phase also establishes the `ContextWindowRegistry` which both server ingestion and UI need. Addresses Pitfall 1 (Schema.Unknown) and Pitfall 5 (alias mismatches) before they can cause damage.
**Delivers:** `OrchestrationThreadContextStatus` schema in contracts; `ThreadContextStatusSetCommand` and `thread.context-status-set` event type added to unions; `contextStatus: Schema.NullOr(...)` with `withDecodingDefault` on `OrchestrationThread`; `packages/shared/src/contextWindow.ts` with `resolveMaxContextTokens()`; `CONTEXT_LEVEL_THRESHOLDS` constants
**Addresses:** ContextWindowRegistry (FEATURES.md P1 item 2), schema correctness prerequisite for all other phases
**Avoids:** Pitfall 1 (Schema.Unknown), Pitfall 5 (alias mismatches), Pitfall 8 (false precision -- confidence tier in schema from the start)

### Phase 2: Server Persistence Layer
**Rationale:** The new projector needs a repository before it can be registered. The migration must run before the table exists. This is pure infrastructure with no behavioral logic -- low risk and unblocks Phase 3.
**Delivers:** `020_ProjectionThreadContextStatus.ts` migration registered in `Migrations.ts`; `ProjectionThreadContextStatus` service interface and layer (SQL implementation); INSERT OR REPLACE by `thread_id` following `ProjectionThreadSessions` exactly
**Uses:** `@effect/sql-sqlite-bun`, Effect `ServiceMap.Service` pattern, migration registration pattern
**Implements:** Projection Repository component (ARCHITECTURE.md section 3)

### Phase 3: Server Processing Pipeline
**Rationale:** With schema (Phase 1) and persistence (Phase 2) complete, the processing layer can be assembled in dependency order. `ProjectionPipeline` and `ProjectionSnapshotQuery` modifications are independent of adapter work (Phase 4). The `ProviderRuntimeIngestion` change gates all data flow from provider events to WebSocket push.
**Delivers:** `threadContextStatus` projector in `ProjectionPipeline` (with cleanup on `thread.deleted` and `thread.reverted`); `contextStatus` hydration in `ProjectionSnapshotQuery`; `thread.token-usage.updated` handler in `ProviderRuntimeIngestion` with `normalizeTokenUsage()` utility function
**Uses:** `resolveMaxContextTokens` from Phase 1; `ProjectionThreadContextStatusRepository` from Phase 2
**Avoids:** Pitfall 4 (stale data -- session lifecycle tied to projector); Pitfall 6 (migration strategy defined up front); Pitfall 9 (no new Effect service -- extend ProviderRuntimeIngestion to avoid dependency cycle); Pitfall 10 (race with turn start -- "pending" state in projection)

### Phase 4: Provider Adapter Normalization (parallel with Phase 2-3)
**Rationale:** Can start as soon as Phase 1 (schema) completes. Independent of persistence and processing changes. Codex already emits correctly and needs no changes. Only `ClaudeCodeAdapter` and `GeminiAdapter` need modification. Claude Code extracts from SDK result messages; Gemini extracts from `usageMetadata` on `GenerateContentResponse`.
**Delivers:** `ClaudeCodeAdapter` emits `thread.token-usage.updated` from `result` SDK messages (`support: "derived-live"`); `GeminiAdapter` emits `thread.token-usage.updated` from `usageMetadata` on turn completion (`support: "derived-on-demand"`); both using canonical payload shape; compaction events wired per provider
**Addresses:** Multi-provider normalization (FEATURES.md table stakes items 3-5), compaction event display
**Avoids:** Pitfall 2 (provider emission asymmetry), Pitfall 3 (compaction handling per provider)

### Phase 5: Web Integration and UI
**Rationale:** Depends on Phase 1 (contracts for web types) and Phase 3 (projection push via WebSocket). Web types mirror the contracts schema. The store mapping is a simple field addition. The UI component uses existing Badge, Tooltip, and Tailwind primitives -- all verified present, no new dependencies.
**Delivers:** `ThreadContextStatus` interface in `apps/web/src/types.ts`; `contextStatus` mapping in `syncServerReadModel`; `ContextStatusIndicator` component in composer footer with 4-tier color coding, "Compacted recently" state, "Context unknown" graceful degradation, responsive compact mode via existing `composerFooterLayout.ts` breakpoints
**Uses:** Existing `Badge`, `Tooltip`, `composerFooterLayout.ts`, `lucide-react` icons
**Avoids:** Pitfall 7 (re-render cascades -- dedicated `useContextStatus` selector with equality check); Pitfall 13 (percentage only shown when model limit is known and not null)

### Phase Ordering Rationale

- Phase 1 must be first: contracts are the shared type language across all layers -- no layer can be type-safe without the canonical schema defined
- Phase 2 is pure infrastructure with no runtime behavior; it is fast and directly unblocks Phase 3
- Phase 4 can start in parallel with Phase 2 because it only needs the schema from Phase 1, not the persistence layer
- Phase 3 and Phase 4 both feed into Phase 5; Phase 5 cannot ship until both are complete
- The build order (1 -> 2 and 4 in parallel -> 3 -> 5) matches the ARCHITECTURE.md suggested build order exactly

### Research Flags

Phases with standard patterns (deep research not needed during planning):
- **Phase 2 (Persistence):** Follow `ProjectionThreadSessions` exactly. Established pattern in codebase, no surprises.
- **Phase 5 (Web UI):** All components verified to exist. Badge/Tooltip/Tailwind is straightforward.

Phases that benefit from validation during implementation:
- **Phase 1 (Schema / Registry):** Model context window limit values for GPT-5.x and Gemini 3.x preview models are MEDIUM confidence (recent or preview). Cross-check against provider docs when implementing `contextWindow.ts`. Mark uncertain values with `// TODO: verify when model GA`.
- **Phase 4 (Adapters):** Codex `thread/tokenUsage/updated` payload shape is inferred from docs, not definitively confirmed (MEDIUM confidence). Run `codex app-server generate-json-schema` during implementation for the authoritative payload structure. Claude Code SDK usage shape is HIGH confidence per official Anthropic docs.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All existing packages verified by direct codebase inspection. Zero new dependencies needed -- no speculation. |
| Features | HIGH | Table stakes derived from competitor analysis with direct user evidence (Cursor forum threads, official docs). Anti-features backed by concrete architecture rationale. |
| Architecture | HIGH | All integration points traced to specific files and line numbers. Follows established patterns exactly. No external references needed. |
| Pitfalls | HIGH | Every pitfall grounded in specific codebase file paths and line numbers. No speculation. All compound interaction effects identified. |

**Overall confidence: HIGH**

### Gaps to Address

- **Codex token usage payload shape (MEDIUM):** The `thread/tokenUsage/updated` payload is currently `Schema.Unknown` and its exact field names are inferred from documentation. Run `codex app-server generate-json-schema` during Phase 1/4 implementation. If field names differ from the expected `{ input_tokens, output_tokens, total_tokens }` shape, update `normalizeTokenUsage()` accordingly before building the projection.

- **Model context window limits for preview and recent models (MEDIUM):** GPT-5.3/5.4 limits (400K-1M) come from community discussion, not official model cards. Gemini 3.x preview limits will change before GA. Mark these values with source comments in `contextWindow.ts` and update when models reach GA. The `resolveMaxContextTokens()` function returning `null` for unknown models is the safe fallback.

- **Compaction post-state for Codex (MEDIUM):** Whether `thread/tokenUsage/updated` after compaction reflects pre- or post-compaction token counts needs live testing. The compaction handling in Phase 3/4 should be validated against a real Codex session that triggers compaction before shipping the feature.

- **React re-render performance at scale (MEDIUM):** Pitfall 7 flags that frequent token usage updates may cause unnecessary re-renders via `syncServerReadModel`. Profile with React DevTools against a live Codex session during Phase 5 implementation. If re-renders propagate beyond `ContextStatusIndicator`, implement a dedicated `useContextStatus(threadId)` selector with shallow equality before shipping.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection (specific files and line numbers) -- all architecture patterns, existing event types, current adapter state, projection infrastructure
- Anthropic Claude Agent SDK official docs (cost tracking, TypeScript reference) -- ClaudeCode usage shape, `SDKResultMessage.usage` and `SDKResultMessage.modelUsage` schemas
- Google `GenerateContentResponse` official docs -- Gemini `usageMetadata` structure and field names
- Claude Models Overview / Context Windows docs -- Claude 200K limits confirmed
- CodexMonitor reference implementation (GitHub: Dimillian/CodexMonitor) -- context ring UX pattern, Codex token event confirmation

### Secondary (MEDIUM confidence)
- Cursor forum threads (context window usage, transparency feedback removed) -- user expectations and table stakes validation for context indicator
- Claude Code status line docs (code.claude.com) -- threshold patterns (green/yellow/red), `used_percentage` field
- Codex App Server official docs -- token usage event architecture, `thread/tokenUsage/updated` notification
- Gemini models documentation -- preview model context limits (subject to change before GA)
- ACC compaction research gist (badlogic) -- 70%/80%/85% threshold conventions, compaction behavior

### Tertiary (LOW confidence)
- GPT-5.x context window values from GitHub issue discussion (#13738) -- needs verification from official model cards when published
- Gemini 3.x preview model limits from Vertex AI docs -- preview designation, limits subject to change

---
*Research completed: 2026-03-13*
*Ready for roadmap: yes*
