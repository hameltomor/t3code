# Domain Pitfalls: Session Context Status

**Domain:** Adding live context status tracking to a multi-provider code agent GUI
**Researched:** 2026-03-13
**Codebase:** XBE Code (Effect-TS, Zustand, event-sourced orchestration)
**Overall confidence:** HIGH -- grounded in codebase inspection, not speculation

---

## Critical Pitfalls

Mistakes that cause rewrites, silent data corruption, or misleading UX.

### Pitfall 1: The `Schema.Unknown` Usage Trap

**What goes wrong:** The existing `ThreadTokenUsageUpdatedPayload` has `usage: Schema.Unknown` (line 293, `providerRuntime.ts`). Similarly, `TurnCompletedPayload` has `usage: Schema.optional(Schema.Unknown)` and `modelUsage: Schema.optional(UnknownRecordSchema)` (lines 331-332). If the new context status projection consumes these fields without typing them, every downstream consumer -- the projector, the read model, the WS push, and the React UI -- operates on `unknown`. This means:
- No compile-time safety when extracting `input_tokens`, `output_tokens`, `cache_read_tokens`, etc.
- Silent failures when a provider changes its usage shape (e.g. Claude SDK bumps a version and renames `cache_creation_input_tokens`)
- Impossible to test normalization correctness without integration tests against live providers

**Why it happens:** The original design intentionally used `Schema.Unknown` because usage data was pass-through for logging, not for computation. Context status changes this -- usage data must be *interpreted*, not just forwarded.

**Consequences:** If you build a context status projection that reads `(event.payload as any).usage.input_tokens`, it will silently produce `undefined` / `NaN` for providers that structure usage differently. You will ship a context bar that shows "0 tokens" for Claude sessions and correct values for Codex, with no type error to catch it.

**Prevention:**
1. Define typed per-provider usage schemas in `contracts` (e.g. `CodexTokenUsage`, `ClaudeCodeTokenUsage`, `GeminiTokenUsage`) with explicit fields
2. Define a `CanonicalTokenUsage` schema that the normalizer produces
3. Normalize in the adapter layer (server-side), NOT in the projection or UI
4. Keep `Schema.Unknown` on the wire event for backward compatibility, but decode into the typed schema at the normalization boundary

**Detection:** If any code path uses `as any` or `as Record<string, unknown>` to access usage fields, this pitfall is active. Grep for `payload.usage` with no prior Schema.decode call.

**Phase:** Address in Phase 1 (Schema/Contract) before building the projection.

---

### Pitfall 2: Codex Pushes Usage Separately, Claude/Gemini Do Not

**What goes wrong:** The three providers report usage through fundamentally different mechanisms:

| Provider | Usage Delivery | Event Type | Current Status in Codebase |
|----------|---------------|------------|----------------|
| Codex | Dedicated push event | `thread.token-usage.updated` | Emitted by `CodexAdapter` (line 700-709), **completely ignored** by `ProviderRuntimeIngestion` -- falls into `default: break` (line 497) |
| Claude Code | Embedded in turn completion | `turn.completed` payload `.usage` / `.modelUsage` | Passed through as `Schema.Unknown` in `ClaudeCodeAdapter` (line 879, 952) |
| Gemini | **Not reported at all** | `turn.completed` payload has NO usage field | `GeminiAdapter` line 272-276 -- payload only contains `state` and optional `errorMessage` |

If you build the projection assuming all providers emit `thread.token-usage.updated`, it will only work for Codex. If you build it assuming usage is in `turn.completed`, it will miss Codex's dedicated events and produce nothing for Gemini.

**Why it happens:** Each provider SDK has different conventions. Codex app-server pushes `thread/tokenUsage/updated` as a notification. Claude Code SDK includes `usage` in the result message. Gemini SDK's `generateContent` response has `usageMetadata` but the current GeminiAdapter discards it.

**Consequences:** Context status works for one provider, shows "unknown" or "0" for others. Users switching between providers see inconsistent data. Worse: if you only test with Codex (the default provider), you ship broken Claude/Gemini support.

**Prevention:**
1. Normalize in each adapter: every adapter emits `thread.token-usage.updated` with a typed canonical payload
2. For Gemini: extract `usageMetadata` from the `GenerateContentResponse` in `callGemini` and emit the event after each response
3. For Claude Code: extract from `turn.completed` result and emit a synthetic `thread.token-usage.updated` event in the adapter
4. The ingestion layer consumes ONE event type, not three different paths
5. Add adapter-level tests that verify each adapter emits `thread.token-usage.updated` with the canonical schema

**Detection:** If `ProviderRuntimeIngestion.processRuntimeEvent` still has no case for `thread.token-usage.updated` after implementation, this pitfall is active.

**Phase:** Address in Phase 1 (Adapter normalization) alongside schema work.

---

### Pitfall 3: Compaction Resets Context, But Accumulated Usage Does Not Reset

**What goes wrong:** When Codex performs context compaction (detected by `CanonicalItemType = "context_compaction"` in the runtime events, line 119 of `providerRuntime.ts`), the model's actual context window resets to a smaller size. But your accumulated `totalInputTokens` / `totalOutputTokens` from prior usage events still reflects the pre-compaction total. If you show "85,000 / 200,000 tokens used" based on accumulated totals, then compaction happens, the model is now working with ~20,000 tokens of compacted context, but your UI still shows 85,000.

**Why it happens:** Usage events report *session-cumulative* totals (Codex) or *per-turn* deltas (Claude). Neither tells you the *current context window occupancy* after compaction. Compaction is a provider-internal optimization that the external usage counters don't model.

**Consequences:** Users see a context bar that never goes down, or worse, it shows "nearly full" when the provider just compacted and has plenty of headroom. This erodes trust in the feature.

**Prevention:**
1. Track two separate metrics: "session cumulative tokens" (always-increasing) and "estimated current context" (resets on compaction)
2. When a `context_compaction` item event arrives, reset the "current context" estimate (or flag it as "recently compacted, estimate may be inaccurate")
3. For Codex: the `thread.token-usage.updated` payload *after* compaction should reflect the new total -- verify this assumption with live testing
4. For Claude/Gemini: compaction behavior differs -- Claude has its own compaction, Gemini does not compact (it will fail at context limit)
5. Show "~" prefix or a "compacted" badge when post-compaction estimates are uncertain

**Detection:** If the context status number never decreases even after you see a `context_compaction` item event in the activity log, this pitfall is active.

**Phase:** Address in Phase 2 (Projection logic), with Phase 3 (UI) showing the uncertainty indicator.

---

### Pitfall 4: Stale Projection After Session Restart or WebSocket Reconnect

**What goes wrong:** The orchestration read model is rebuilt from events via `projectEvent()` in `projector.ts`. When a WebSocket client reconnects, it fetches the snapshot via `orchestration.getSnapshot`. If the context status projection is stored as part of the thread state in the read model, but the projection worker has not yet processed recent `thread.token-usage.updated` events (queue lag), the client gets a stale snapshot. Worse: if the session stops and restarts (common during `session.exited` -> new `thread.turn.start`), the context status from the old session leaks into the new session's display.

**Why it happens:** The `ProviderRuntimeIngestion` processes events via an unbounded queue (line 1168, `ProviderRuntimeIngestion.ts`), which means events can lag behind the snapshot. The projector (`ProjectionPipeline`) runs as a separate pipeline. There is an inherent race between: (a) the ingestion layer processing runtime events into commands, (b) the engine applying commands to produce domain events, (c) the projection pipeline projecting events into the read model, and (d) the WS client receiving the snapshot.

**Consequences:** Flash of stale data on reconnect. Context bar shows "150K tokens" from a prior session for 500ms until the new session's first usage event arrives and resets it. Or the client never sees the reset because the session stop event arrived before the usage event.

**Prevention:**
1. Tie context status data to the `session` object on `OrchestrationThread`, not as a separate field. When `session` is set to null or a new session replaces the old one, context status automatically resets
2. On `session.exited` and `session.started` events, explicitly clear/initialize the context status in the projection
3. On the UI side, treat `session === null` or `session.status === "stopped"` as "no context data available" (not "0 tokens")
4. Consider a monotonic `lastUsageSequence` field so the UI can detect when displayed data is older than the current session

**Detection:** Open a thread, run a long conversation, stop the session, start a new one. If the context bar shows the old session's numbers for any period, this pitfall is active.

**Phase:** Address in Phase 2 (Projection) -- session lifecycle integration.

---

### Pitfall 5: Model Limit Registry Hardcoding and Aliasing Mismatches

**What goes wrong:** The codebase already has model aliasing in `MODEL_SLUG_ALIASES_BY_PROVIDER` (lines 68-96, `model.ts`). The context status feature needs a model limit registry (max context tokens per model). If this registry uses hardcoded model slugs but doesn't account for aliases, then:
- User selects "opus" (alias) -> resolves to "claude-opus-4-6" (slug) -> but limit registry has entry for "claude-opus-4.6" (different format) -> no limit found -> "unknown" displayed
- Model rerouting (the `model.rerouted` event from Codex, line 1053 of `CodexAdapter.ts`) changes the effective model mid-session, but the context status still uses the original model's limit

Additionally, `MODEL_OPTIONS_BY_PROVIDER` only lists known models. Users can specify custom/fine-tuned model slugs (the type is `ModelSlug = BuiltInModelSlug | (string & {})`). The limit registry has no entry for these.

**Why it happens:** Model names are free-form strings in the current schema (`model: TrimmedNonEmptyString` on `OrchestrationThread`). The alias resolution happens in `@xbetools/shared/model` but the limit registry would be a new, separate lookup. If they diverge, lookups fail silently.

**Consequences:** Context bar shows "42,000 tokens used" with no denominator, or shows "42,000 / [unknown limit]" which is worse than not showing limits at all. If the limit is wrong (e.g. showing 128K limit for a 200K model), users incorrectly think they are almost out of context.

**Prevention:**
1. The limit registry MUST use the same resolved slug that `resolveModelSlugForProvider` returns -- not raw user input, not aliases
2. Include a `"unknown"` / `null` sentinel in the limit type -- never default to a number when the model is not recognized
3. Listen for `model.rerouted` events and update the effective model (and its limit) in the context status projection
4. Store limits as `{ maxContextTokens: number | null, source: "hardcoded" | "provider-reported" }` so the UI can show confidence
5. For unknown models: show cumulative usage without a progress bar, not a bar with a guessed denominator
6. Implement the registry as a pure function `(provider: ProviderKind, resolvedSlug: string) => ModelContextLimit | null` in `packages/contracts` or `packages/shared` so it can be tested and shared

**Detection:** Select a model via alias (e.g. "opus"), check if the context bar shows a limit. If it doesn't, or shows the wrong limit, this pitfall is active.

**Phase:** Address in Phase 1 (Registry in `packages/shared` or `packages/contracts`), with Phase 2 handling `model.rerouted` events.

---

## Moderate Pitfalls

### Pitfall 6: Adding a New Projection Type Without Migration Strategy

**What goes wrong:** The `ProjectionPipeline` (see `ProjectionPipeline.ts`) replays all events from the event store to build projections. Adding a new projection (context status) means:
- Existing persisted events don't have the new orchestration event type (e.g. `thread.context-status-updated`)
- If context status is derived from `thread.token-usage.updated` runtime events, those are NOT persisted as orchestration events today -- they are silently dropped by `ProviderRuntimeIngestion`
- Replaying existing events will produce threads with no context status, which is correct but requires the UI to handle "no data" gracefully

**Prevention:**
1. Do NOT add a new orchestration event type for context status -- derive it as a server-side projection from runtime events, similar to how `activities` are derived
2. If you must persist context status, make it a field on the `thread.session-set` command/event payload rather than a new event type
3. The projection must handle "no usage data exists for this session" as a first-class state, not a missing-data error
4. Add a schema version or feature flag so the read model gracefully handles the new field being absent in older snapshots

**Phase:** Address in Phase 2 (Projection design decision).

---

### Pitfall 7: React Re-Render Cascades From Frequent Usage Updates

**What goes wrong:** The Zustand store (`store.ts`) syncs the entire `OrchestrationReadModel` via `syncServerReadModel`. Every orchestration event triggers a WS push -> `syncServerReadModel` call -> full thread object replacement. If context status updates arrive every few seconds (Codex pushes `thread/tokenUsage/updated` frequently during long turns), this causes:
- Full thread object replacement in Zustand state
- All components subscribed to the thread re-render
- The composer footer (where context bar lives) re-renders, but so does the message list, the sidebar, etc.

The existing codebase already has `useThread(threadId)` and `useShallow` patterns, but `useThread` returns the full `Thread` object. Any new field on `Thread` (like `contextStatus`) that changes frequently will cause re-renders of everything that consumes `useThread`.

**Prevention:**
1. Store context status in a SEPARATE Zustand slice or a dedicated store, not on the `Thread` type
2. Or: add a dedicated `useContextStatus(threadId)` selector hook that only subscribes to the context status field via a `useStore` callback with a custom equality check
3. Throttle usage event processing on the server side -- batch `thread.token-usage.updated` events and only push aggregated updates every N seconds (the ingestion queue already processes events sequentially, so add a time-based flush)
4. On the client side, use `requestAnimationFrame` or a debounced selector to prevent the context bar from repainting on every update

**Detection:** Open React DevTools Profiler, send a message in a Codex session, observe whether the message list re-renders when only the context status changes.

**Phase:** Address in Phase 3 (UI implementation).

---

### Pitfall 8: Claiming Equal Precision Across Providers

**What goes wrong:** Codex reports detailed token breakdowns (input, output, cached, reasoning). Claude Code reports `input_tokens`, `output_tokens`, and `cache_creation_input_tokens` / `cache_read_input_tokens`. Gemini currently reports nothing. If the UI shows the same level of detail for all providers, it either:
- Shows "N/A" for most fields on some providers (cluttered, confusing)
- Shows a single "tokens used" number that means different things per provider (misleading)

**Prevention:**
1. Define confidence tiers for the canonical usage: `{ tier: "detailed" | "estimated" | "unavailable" }`
2. The UI adapts its rendering based on the tier -- full breakdown for "detailed", single bar for "estimated", "Context tracking unavailable for this provider" for "unavailable"
3. Never show a number with false precision -- if you are summing input + output as a proxy for "context used", label it as "~tokens" not "tokens"
4. Document per-provider data availability in the model limit registry

**Phase:** Address in Phase 1 (Schema design -- the canonical usage type includes a confidence/tier field), Phase 3 (UI renders conditionally).

---

### Pitfall 9: Effect Service Layer Dependency Cycles

**What goes wrong:** The server uses Effect's `ServiceMap.Service` pattern extensively. Adding a new `ContextStatusService` or similar requires:
- Declaring the Service tag in a `Services/` file
- Implementing the Layer in a `Layers/` file
- Wiring it into `serverLayers.ts`

Common mistake: the new service needs `ProviderService` (to access runtime events) AND `OrchestrationEngineService` (to dispatch commands). But `ProviderRuntimeIngestionLive` already depends on both. If the new service is consumed by `ProviderRuntimeIngestion`, you create a dependency cycle.

Looking at `serverLayers.ts` lines 96-129: `orchestrationLayer` -> `ProviderRuntimeIngestionLive` -> needs `ProviderService`. If a new context status layer needs both `ProviderService` and the orchestration engine, it must be wired at the same level as `ProviderRuntimeIngestion`, not as a dependency of it.

**Prevention:**
1. Do NOT create a separate `ContextStatusService` -- extend `ProviderRuntimeIngestion` to process `thread.token-usage.updated` events (it already has the right dependency context)
2. If a separate service is needed, make it consume domain events via `orchestrationEngine.streamDomainEvents`, not runtime events directly -- this avoids depending on `ProviderService`
3. Draw the dependency graph BEFORE writing the Layer. Verify no cycles exist in `serverLayers.ts` wiring
4. Use Effect's `Layer.provide` / `Layer.provideMerge` carefully -- `provideMerge` creates diamonds, not cycles, which is fine

**Phase:** Address in Phase 2 (Architecture decision before coding).

---

### Pitfall 10: Race Between `turn.started` and First Usage Event

**What goes wrong:** When a turn starts, the sequence is:
1. Client dispatches `thread.turn.start` command
2. `ProviderCommandReactor` calls `providerService.sendTurn()`
3. Provider adapter emits `turn.started` event
4. Provider processes the request...
5. Provider emits first `thread.token-usage.updated` (Codex) or completes the turn with usage (Claude)

If the UI shows context status and the user sends a message, there is a window between steps 1-3 where the context bar has old data. Then at step 5, the new data arrives. But if the turn fails at step 3 (e.g. rate limit), the usage event never comes. The context bar is now showing data from the *previous* turn with no indication it is stale.

**Prevention:**
1. On `turn.started`: mark context status as "updating..." / show a loading indicator on the context bar
2. On `turn.completed` (even with error): if no usage data arrived during the turn, explicitly mark the context status as "stale" or "last updated at [time]"
3. Include a `lastUpdatedAt` timestamp in the context status so the UI can show staleness ("Updated 5 min ago")
4. Never clear the last known usage data on turn start -- it is better to show slightly stale data than empty

**Phase:** Address in Phase 2 (Projection state machine includes "pending" state), Phase 3 (UI renders staleness).

---

## Minor Pitfalls

### Pitfall 11: Forgetting to Clean Up Context Status on Thread Delete

**What goes wrong:** When a thread is deleted (`thread.deleted` event), the projection removes the thread. But if context status is stored in a separate table/cache (e.g. for the "separate Zustand slice" approach from Pitfall 7), the cleanup is missed.

**Prevention:** Tie context status lifecycle to the thread/session lifecycle. If it's a field on the session object, it's automatically cleaned up. If separate, add cleanup handlers for `thread.deleted` and `session.exited`.

**Phase:** Address alongside wherever context status storage is implemented.

---

### Pitfall 12: Not Handling `model.rerouted` in the Limit Registry

**What goes wrong:** Codex can reroute to a different model mid-session (e.g. from `gpt-5.4` to `gpt-5.3-codex` due to capacity). The `model.rerouted` event is emitted (CodexAdapter line 1053) but currently ignored by ProviderRuntimeIngestion. If the context bar shows limits based on the original model, they may be wrong after rerouting.

**Prevention:** Process `model.rerouted` in the ingestion layer and update both the thread's model field and the context status limit. Emit a `thread.meta.update` with the new model.

**Phase:** Address in Phase 2.

---

### Pitfall 13: Percentage Precision Without Actual Limits

**What goes wrong:** Showing "85% context used" requires both current usage AND the max limit. For unknown models or models where the limit is uncertain, calculating a percentage is misleading. Showing "85%" when the real limit is unknown gives false confidence.

**Prevention:** Only show percentages when `modelLimit.source === "hardcoded" | "provider-reported"` AND `modelLimit.maxContextTokens !== null`. Otherwise show absolute token count only.

**Phase:** Address in Phase 3 (UI conditional rendering).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| **Schema/Contract design** | Pitfall 1 (Schema.Unknown), Pitfall 5 (alias mismatches), Pitfall 8 (precision tiers) | Type the canonical usage schema explicitly. Include provider confidence tier. Ensure limit registry uses resolved slugs. |
| **Adapter normalization** | Pitfall 2 (provider differences), Pitfall 3 (compaction) | Every adapter must emit `thread.token-usage.updated` with canonical payload. Handle compaction as a "context reset" signal. |
| **Projection pipeline** | Pitfall 4 (stale data on reconnect), Pitfall 6 (migration), Pitfall 9 (Effect dependency cycle), Pitfall 10 (race conditions) | Extend ProviderRuntimeIngestion (don't add new service). Tie status to session lifecycle. Add "pending" state for between-turn windows. |
| **UI rendering** | Pitfall 7 (re-render cascades), Pitfall 8 (false precision), Pitfall 13 (percentages without limits) | Separate Zustand slice or dedicated selector. Conditional rendering by provider tier. Throttle updates. |
| **Compaction handling** | Pitfall 3 (accumulated vs current context) | Track "current context estimate" separately from "session cumulative". Reset on compaction. Show uncertainty. |
| **Session lifecycle** | Pitfall 4 (stale after restart), Pitfall 10 (race with turn start), Pitfall 12 (model rerouting) | Clear on session exit. "Updating..." on turn start. Handle model reroute events. |

---

## Interaction Effects

Several pitfalls compound when hit together:

- **Pitfalls 1 + 2**: If `Schema.Unknown` is consumed without normalization AND providers report usage differently, you get type-unsafe code that also handles three different shapes -- a combinatorial maintenance nightmare. Solve 1 (typed schemas) and 2 (unified adapter emission) together.

- **Pitfalls 3 + 4**: Compaction resets the current context estimate, but if that reset arrives during a reconnect window, the client may never see it. The stale data from the pre-compaction state persists. Tying context status to the session object (Pitfall 4 prevention) helps because session replacement forces a re-fetch.

- **Pitfalls 5 + 12**: A `model.rerouted` event changes the effective model, which changes the limit denominator. If the rerouting happens to a model not in the registry (Pitfall 5), the context bar loses its denominator AND the numerator may be based on the wrong model's token counting. The limit registry must return null gracefully, and the UI must handle the transition from "known limit" to "unknown limit" mid-session.

- **Pitfalls 7 + 10**: Frequent usage updates (causing re-renders via Pitfall 7) combined with the "updating..." state on turn start (Pitfall 10) means the context bar may flicker between "stale", "updating...", and the new value several times per second during an active turn. Throttling (Pitfall 7 prevention) and debouncing the "updating..." indicator (show only after 500ms delay) mitigate this.

- **Pitfalls 8 + 13**: Claiming equal precision (Pitfall 8) plus showing percentages without limits (Pitfall 13) compounds into a deeply misleading UI: "85% context used" for a Gemini session where you have no usage data AND no model limit -- the 85% is entirely fabricated. The tier system from Pitfall 8 prevents Pitfall 13 from occurring.

---

## Sources

- **Codebase inspection** (HIGH confidence): All pitfalls grounded in specific files and line numbers
  - `packages/contracts/src/providerRuntime.ts` -- event types, Schema.Unknown usage fields (lines 119, 146, 292-295, 329-336)
  - `packages/contracts/src/model.ts` -- MODEL_OPTIONS_BY_PROVIDER, aliases, slug types (lines 35-96)
  - `packages/contracts/src/orchestration.ts` -- OrchestrationThread, OrchestrationSession, read model, event types
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` -- event processing, `default: break` at line 497, unbounded queue at line 1168
  - `apps/server/src/orchestration/projector.ts` -- projection logic, thread update patterns, `projectEvent` function
  - `apps/server/src/provider/Layers/CodexAdapter.ts` -- usage event emission (lines 700-709), model.rerouted (line 1053)
  - `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` -- usage in turn.completed (lines 879, 952, 1338, 1351)
  - `apps/server/src/provider/Layers/GeminiAdapter.ts` -- NO usage in turn.completed (lines 272-276), GeminiSessionContext (lines 112-125)
  - `apps/server/src/serverLayers.ts` -- Effect Layer dependency wiring (lines 96-129)
  - `apps/web/src/store.ts` -- Zustand store, syncServerReadModel pattern, useThread selector
  - `apps/web/src/types.ts` -- Thread, ThreadSession types (lines 91-122)
  - `apps/server/src/orchestration/Services/ProviderRuntimeIngestion.ts` -- Service tag pattern, Shape interface

---

*Pitfalls research for: Session Context Status -- XBE Code*
*Researched: 2026-03-13*
