# Feature Landscape

**Domain:** Session Context Status for Multi-Provider Code Agent GUI
**Researched:** 2026-03-13

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Context percentage badge | Every competitor shows this. Cursor had it (users revolted when removed in 2.0), Windsurf added a real-time meter to footer, Claude Code exposes `used_percentage` in status line, CodexMonitor has a "context usage ring". Users need to know when to start a new session. | Low | Single text/badge component reading from snapshot. Already decided: minimal badge in composer footer. |
| Threshold-based color coding | Claude Code's official multi-line status line example uses green <70%, yellow 70-89%, red >=90%. Windsurf warns when approaching limits. ACC compaction research shows 70% warning, 80% action thresholds are standard. Users expect visual urgency escalation without reading numbers. | Low | CSS class switching based on `percentUsed` from projection. Four tiers: neutral <70%, watch 70-85%, warning 85-95%, danger >=95%. |
| Compaction event display | Claude Code auto-compacts and exposes `compact_boundary`. Codex app-server pushes `thread/compacted`. Windsurf auto-summarizes. Users need to know when context was compacted because it changes the effective conversation state and can explain "why did the agent forget X?" | Med | Requires mapping compaction events from all 3 providers into the projection. Codex and Claude already emit compaction signals; Gemini has no native compaction. Show "Compacted recently" state in badge that decays on next usage update. |
| "Unknown" / graceful degradation state | Gemini has no native context status. Provider may not have started yet. First API call may not have completed. Claude Code docs explicitly note `used_percentage` can be null early in session. Must not show fabricated data. | Low | Show "Context unknown" or hide badge entirely when data is absent. Never display a fake percentage. Investigation doc calls this out as a firm requirement. |
| Per-provider data source honesty | Codex pushes native token usage. Claude derives from SDK usage payloads. Gemini computes from `usageMetadata` + `countTokens`. Precision varies. Cursor users specifically complained about loss of transparency when the indicator was simplified. Claude Code community tools differentiate cumulative vs current usage. | Low | Investigation doc recommends `support` field: "native" / "derived-live" / "derived-on-demand". Surface distinction in tooltip or label, not necessarily in the minimal badge but captured in the data model. |
| Survive reconnect / page refresh | This repo already delivers all state via projection snapshots, not ephemeral client state. Context status must work the same way. If context status disappears on reconnect while session status persists, users will notice the inconsistency immediately. | Med | Requires projection persistence (new DB row) and snapshot hydration. The investigation doc specifies `projection_thread_context_status` table. Without this, context status is ephemeral and resets on any disruption. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Unified multi-provider context view | No competitor shows normalized context status across Codex, Claude Code, and Gemini in a single UI. Cursor is single-provider. Windsurf is single-provider. CodexMonitor is Codex-only. This is unique to XBE Code's multi-provider architecture and is the core value of this milestone. | High | The normalization layer across 3 providers with different data fidelity levels IS the differentiator. Individual provider support is table stakes; a unified view is novel. |
| Source/freshness labels | Claude Code community tools (ccstatusline, ccusage) show data source details. No GUI tool exposes data freshness ("live" vs "stale" vs "unknown") alongside the percentage. This gives power users confidence in what the number means. | Low | Data model stores `source` and `freshness` fields per investigation doc. First delivery: store in projection. Future: surface in tooltip. Minimal badge can optionally show "derived" suffix as `Context 86% (derived)`. |
| Token breakdown tooltip | Claude Code's `/context` command shows input/output/cache breakdown. Cursor forum users requested per-component token accounting. No GUI tool provides hover-to-see-breakdown. | Med | Rich data model stores `inputTokensUsed`, `outputTokensUsed`, `cachedInputTokens`, `reasoningTokens`. First delivery: store in projection, do not render. Future: tooltip with breakdown on hover/tap. |
| Compaction history with timestamp | Claude Code shows compaction events. No GUI tool persists when compaction happened and why. Useful for debugging "why did the agent forget X?" scenarios that frustrate users in long sessions. | Low | Store `lastCompactedAt` and `lastCompactionReason` in projection. First delivery: "Compacted recently" badge state. Future: tooltip shows exact time and reason. |
| Adaptive context budget warnings | ForgeCode and ACC research document progressive warning stages: 70% monitoring, 80% observation masking, 85%+ active reduction. A GUI that warns before the provider auto-compacts gives users time to manually compact or start a new thread. | Med | Requires reliable threshold detection. Codex and Claude emit compaction near limits, but Gemini requires server-side threshold checking. First delivery: color thresholds only. Future: optional notification/toast at configurable thresholds. |
| Display mode preference | Investigation doc recommends future setting to choose between "Minimal badge" and "Full pill + tooltip". No competitor offers this user preference. | Low | Architecture supports this via settings. Not in first delivery but the component API must accommodate switching between compact and expanded rendering modes without a rewrite. |
| Model-specific context limits | Different models have vastly different context windows (Codex GPT-5.x: 400k+, Claude Opus 4.6: 200k, Claude Sonnet 4.6: 200k, Gemini 3.1 Pro: 2M). A `ContextWindowRegistry` that resolves per-model limits powers accurate percentage calculations. | Med | Requires curated mapping for built-in models in `MODEL_OPTIONS_BY_PROVIDER` + alias-aware resolution via `MODEL_SLUG_ALIASES_BY_PROVIDER` + provider API fallback for unknown models. The investigation doc warns against hardcoding one global limit. Critical for percentage accuracy. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Browser-side token counting / estimation | Adds latency, complexity, and gives false precision. Server owns the projection. Client should never try to independently compute context occupancy from message text lengths. Breaks the repo's architecture pattern where all state is server-projected. | Always use server-projected values. If server has no data, show "unknown". |
| Provider-specific UI branches | Rendering different context status components per provider creates maintenance debt and inconsistent UX. Cursor's provider-specific logic contributed to removal/degradation complaints. Three separate components = three places to fix bugs. | Normalize all provider data server-side into one `OrchestrationThreadContextStatus` shape. UI renders one component for all providers. Provider differences are captured in `support` and `source` metadata fields. |
| Per-message token counts | Cursor users requested this but it requires per-message instrumentation that is expensive, provider-specific, and often imprecise. Claude Code accumulates totals, not per-message. Codex pushes thread-level usage. The data simply is not available at message granularity for most providers. | Show thread-level context occupancy. Do not attempt per-message granularity. |
| Real-time streaming token counter | Live "500tk -> 800tk -> 1200tk" animation during API calls. Expensive, distracting, and most providers only report usage after call completion. Claude Code status line updates after each assistant message, not during streaming. | Update context status after turn completion or on provider push events. Do not animate during streaming. |
| Context status in message timeline | Context is current thread runtime state, not historical message content. Putting it in the timeline conflates two domains and clutters the conversation view. The investigation doc explicitly calls this out. | Keep context status in composer footer, separate from message history. It is thread-scoped, not message-scoped. |
| Cost display in context badge | Cost tracking is a separate concern from context window occupancy. Mixing them in one badge creates confusion (is 42% about tokens or budget?). Claude Code keeps them as separate status line widgets. CodexMonitor keeps them separate. | Context badge shows only context occupancy. Cost tracking is a separate future feature with its own projection. |
| Automatic new-thread suggestion | Auto-prompting "Start a new thread?" when context is high is presumptuous and disruptive. The user may want to continue, or the provider may auto-compact successfully. Codex and Claude Code both handle compaction silently. | Show color-coded warning at thresholds. Let the user decide what to do. |
| Polling-based context refresh | Browser-side polling the server for context updates at intervals. Violates the repo's push-based event architecture. Adds unnecessary load and introduces staleness. | Context status flows through the same push pipeline as all other orchestration state: runtime event -> normalization -> projection -> snapshot -> web sync. |

## Feature Dependencies

```
ContextWindowRegistry (model limits) --> Percentage calculation
  |
  v
Provider adapter normalization (Codex native, Claude derived, Gemini computed)
  |
  v
thread.token-usage.updated runtime event emission (all 3 providers)
  |
  v
ProviderRuntimeIngestion handler for thread.context-status.set command
  |
  v
ProjectionPipeline persistence (projection_thread_context_status table)
  |
  v
ProjectionSnapshotQuery hydration (thread.contextStatus on OrchestrationThread)
  |
  v
Web app snapshot sync (contextStatus field on client Thread type)
  |
  v
Composer footer badge component (renders from snapshot state)
```

Compaction events follow the same pipeline but enter at the adapter level:
```
Provider compaction signal --> adapter maps to thread.state.changed(compacted)
  |
  v
Normalizer sets status: "compacted", lastCompactedAt, lastCompactionReason
  |
  v
Same projection pipeline as above
```

Cross-cutting dependency:
```
composerFooterLayout.ts (shouldUseCompactComposerFooter)
  |
  v
Badge component must respect compact breakpoint for responsive layout
```

## MVP Recommendation

Prioritize for first delivery:

1. **Schema + projection infrastructure** (Table stakes: survive reconnect, projection-backed)
   - `OrchestrationThreadContextStatus` in `packages/contracts`
   - `contextStatus` field on `OrchestrationThread` and web `Thread` type
   - New projection table + repository
   - `ProviderRuntimeIngestion` handler for `thread.context-status.set`
   - `ProjectionSnapshotQuery` hydration

2. **ContextWindowRegistry** (Table stakes: accurate percentage calculation)
   - Curated mapping for all models in `MODEL_OPTIONS_BY_PROVIDER`
   - Alias-aware resolution via `MODEL_SLUG_ALIASES_BY_PROVIDER`
   - Provider-native limit override when available
   - `null` fallback for unknown models

3. **Codex adapter wiring** (Table stakes: gold-standard provider already emits events)
   - Wire existing `thread.token-usage.updated` through normalization
   - Include compaction events
   - Set `support: "native"`, `source: "provider-event"`, `freshness: "live"`

4. **Claude adapter normalization** (Table stakes + Differentiator: multi-provider)
   - Emit `thread.token-usage.updated` from SDK `usage` payloads on `task_progress`, `task_notification`, result messages
   - Map `compact_boundary` to compaction status
   - Set `support: "derived-live"`, `source: "sdk-usage"`, `freshness: "live"`

5. **Gemini adapter normalization** (Table stakes + Differentiator: multi-provider)
   - Emit usage from `usageMetadata` on turn completion
   - Optionally call `countTokens` for current transcript snapshot
   - Set `support: "derived-on-demand"`, `source: "count-tokens"`, `freshness: "stale"` between turns

6. **Minimal badge component** (Table stakes: visible context percentage)
   - "Context 42%" text in composer footer alongside provider/model picker
   - Threshold color coding (neutral/watch/warning/danger)
   - "Compacted recently" state
   - "Context unknown" graceful degradation
   - Responsive: respects existing `shouldUseCompactComposerFooter` breakpoint

Defer to future milestone:
- **Token breakdown tooltip**: Rich data stored in projection but not rendered. The normalization work is the hard part and ships in MVP. UI tooltip is straightforward addition.
- **Source/freshness labels in UI**: Data model captures this. First delivery badge is intentionally minimal per product decision.
- **Display mode preference setting**: Component API supports switching structurally. Settings UI is separate scope.
- **Adaptive notifications/toasts**: Color thresholds suffice for first delivery. Toast notifications require notification infrastructure work.

## Existing Codebase Dependencies

| Existing Component | How Context Status Uses It |
|-------------------|---------------------------|
| `packages/contracts/src/providerRuntime.ts` | `thread.token-usage.updated` event type already defined (line 146). `ThreadTokenUsageUpdatedPayload` exists but has untyped `usage: Schema.Unknown` (line 293). Needs structured normalization into the new context status shape. |
| `packages/contracts/src/orchestration.ts` | `OrchestrationThread` (line 284) needs new optional `contextStatus` field. New internal command type `thread.context-status.set` and corresponding event needed. `OrchestrationEventType` union must be extended. |
| `packages/contracts/src/model.ts` | `MODEL_OPTIONS_BY_PROVIDER` (line 35) provides model slugs for all 3 providers. `MODEL_SLUG_ALIASES_BY_PROVIDER` (line 68) provides alias resolution. ContextWindowRegistry maps these to token limits. |
| `apps/server/src/provider/Layers/CodexAdapter.ts` | Already emits `thread.token-usage.updated` with native Codex data. Needs normalization step to produce structured `OrchestrationThreadContextStatus`. |
| `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` | Emits `session.state.changed` for compaction, `compact_boundary` -> `thread.state.changed`, rate-limit events. Does NOT emit `thread.token-usage.updated`. Must extract `usage` from `task_progress`, `task_notification`, and result messages. |
| `apps/server/src/provider/Layers/GeminiAdapter.ts` | Emits nothing about usage currently. Must extract `usageMetadata` from `generateContent` responses and optionally call `countTokens`. |
| `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` | Handles session lifecycle, messages, plans, activities, diffs, checkpoints. Does NOT handle `thread.token-usage.updated`. New handler required. |
| `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` | Persists all projections. New table + handler needed for context status. |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` | Hydrates the `OrchestrationReadModel`. Must hydrate `contextStatus` on each thread. |
| `apps/web/src/components/ChatView.tsx` | Composer footer at line ~3896 (`data-chat-composer-footer`). Badge component inserts alongside the ProviderModelPicker, CodexTraitsPicker, and interaction mode toggle in the left-side control group. |
| `apps/web/src/components/composerFooterLayout.ts` | `shouldUseCompactComposerFooter` (620px / 720px breakpoints) determines compact layout. Badge must hide label text or shrink in compact mode. |

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Schema + projection infrastructure | HIGH | MEDIUM | P1 |
| ContextWindowRegistry | HIGH | LOW | P1 |
| Codex adapter wiring | HIGH | LOW | P1 |
| Claude adapter normalization | HIGH | MEDIUM | P1 |
| Gemini adapter normalization | HIGH | MEDIUM | P1 |
| Minimal badge component | HIGH | LOW | P1 |
| Threshold color coding | HIGH | LOW | P1 |
| Compaction event display | MEDIUM | LOW | P1 |
| Graceful "unknown" state | HIGH | LOW | P1 |
| Projection persistence (survive reconnect) | HIGH | MEDIUM | P1 |
| Source/freshness labels in tooltip | MEDIUM | LOW | P2 |
| Token breakdown tooltip | MEDIUM | LOW | P2 |
| Display mode preference setting | LOW | LOW | P2 |
| Compaction history tooltip | LOW | LOW | P2 |
| Adaptive notification toasts | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Required for this milestone -- ships with context status MVP
- P2: Add after MVP validated -- leverages data already stored in projection
- P3: Future consideration -- requires additional infrastructure

## Competitor Feature Analysis

| Feature | Cursor | Windsurf | Claude Code CLI | CodexMonitor | Continue.dev | XBE Code (This) |
|---------|--------|----------|-----------------|--------------|--------------|-----------------|
| Context percentage | Had pie chart + hover %, removed in 2.0, users angry | Footer meter, real-time | `used_percentage` in status line JSON | "Context usage ring" in composer | Not shipped (feature request) | Minimal badge in composer footer |
| Color thresholds | Unknown (was removed) | Not documented | Official example: green/yellow/red | Not documented | N/A | 4-tier: neutral/watch/warning/danger |
| Compaction display | Auto-summarize, no notification | Auto-summarize, no notification | Compaction events, `/compact` command | Unknown | N/A | "Compacted recently" badge state |
| Token breakdown | Requested by users, not shipped | Not shown | `/context` command, detailed | Not shown | Not shown | Stored in projection, tooltip in P2 |
| Multi-provider | Single (Claude/GPT) | Single (multi-model, single provider) | Single (Claude) | Single (Codex) | Multi-model, no context display | Normalized across Codex, Claude, Gemini |
| Data source transparency | Lost in 2.0, users complained | Not shown | Community tools differentiate | Not shown | N/A | `support`/`source`/`freshness` in data model |
| Persist across reconnect | Unknown | Unknown | Status line re-reads on update | In-memory | N/A | Projection-backed, survives reconnect |

## Sources

- Claude Code status line docs: https://code.claude.com/docs/en/statusline (HIGH confidence -- official docs, verified via WebFetch)
- Claude Code context window progress bar: https://gist.github.com/davidamo9/764415aff29959de21f044dbbfd00cd9 (MEDIUM confidence -- community gist)
- Claude Code context status line npm package: https://www.npmjs.com/package/@this-dot/claude-code-context-status-line (MEDIUM confidence)
- ccstatusline tool: https://github.com/sirmalloc/ccstatusline (MEDIUM confidence -- community tool)
- Cursor context window usage forum: https://forum.cursor.com/t/context-window-usage/139957 (HIGH confidence -- direct user reports)
- Cursor transparency feedback: https://forum.cursor.com/t/diminishing-transparency-in-context-usage-indicator/149973 (HIGH confidence -- direct user reports)
- Cursor context indicator removed: https://forum.cursor.com/t/the-consumption-indicator-of-the-context-window-appears-to-have-been-removed/139914 (HIGH confidence -- direct user reports)
- Windsurf context awareness docs: https://docs.windsurf.com/context-awareness/windsurf-overview (MEDIUM confidence)
- Windsurf context management guide: https://iceberglakehouse.com/posts/2026-03-context-windsurf/ (MEDIUM confidence -- third-party guide)
- Continue.dev token usage discussion: https://github.com/continuedev/continue/discussions/10567 (MEDIUM confidence -- open discussion)
- GitHub community context indicator request: https://github.com/orgs/community/discussions/162496 (MEDIUM confidence -- feature request)
- CodexMonitor README: https://github.com/Dimillian/CodexMonitor (HIGH confidence -- reference implementation)
- Codex app-server SDK docs: https://developers.openai.com/codex/sdk/ (HIGH confidence -- official docs)
- OpenAI compaction guide: https://developers.openai.com/api/docs/guides/compaction/ (HIGH confidence -- official docs)
- ACC compaction research: https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f (MEDIUM confidence -- research gist)
- ForgeCode context compaction docs: https://forgecode.dev/docs/context-compaction/ (MEDIUM confidence)
- Claude Code `/context` issue: https://github.com/anthropics/claude-code/issues/6055 (MEDIUM confidence -- feature discussion)
- Internal investigation doc: `tmp/session-context-status-investigation.md` (HIGH confidence -- project-specific verified research)
