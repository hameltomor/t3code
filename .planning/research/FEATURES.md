# Feature Research

**Domain:** Chat/conversation history import — developer tool (code agent GUI)
**Researched:** 2026-03-12
**Confidence:** MEDIUM — table stakes derived from surveying IDE extensions (VS Code Copilot, JetBrains AI, Cursor, Windsurf, Cody), chat app migration tooling (Slack, Discord), and general data import UX patterns. Provider format findings (Codex, Claude Code, Gemini CLI) are HIGH confidence from official docs and primary sources.

---

## Context: What We're Building

XBE Code imports existing conversations from native CLI providers (Codex at `~/.codex/`, Claude Code at `~/.claude/`, Gemini CLI at `~/.gemini/`) and materializes them as normal XBE threads — discoverable by workspace path, previewable before committing, and live-resumable through the Codex app-server `thread/resume` protocol.

The import is a **subsequent milestone** added to an existing app. The XBE thread model already exists (`OrchestrationThread`, event-sourced with `thread.created` + `thread.message-sent` events, project-scoped). Imported threads become first-class citizens.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Workspace-path-scoped discovery | Users work in dozens of repos; only relevant conversations matter. Every competitor (Cursor Chronicle, Claude Code viewer, Codex history list) filters by project path. | LOW | Codex: filter `thread/list` by `workingDirectory`. Claude Code: filter `~/.claude/projects/<encoded-path>/` directories. Gemini: filter `~/.gemini/tmp/` by session metadata. |
| Preview before import | Standard for all data migration tools — Slack, email clients, HubSpot all show preview before commit. Users need to verify what they're importing. | MEDIUM | Show thread title, message count, date range, first user message. Do not require reading full JSONL on first render — use session metadata/index files. |
| Per-thread selective import | Import is high-risk if it's all-or-nothing. Slack, eM Client, and VS Code chat exporters all offer selection. Users have hundreds of stale/noise threads. | MEDIUM | Checkbox list; multi-select with select-all. Ordering: most recently modified first. |
| Deduplication / already-imported detection | Without this, users repeatedly see the same threads. Codex thread IDs are stable UUIDs; Claude Code session IDs are stable. Store provider thread ID → XBE thread ID mapping. | MEDIUM | Check `providerThreadId` against existing threads before showing in list. Mark already-imported as "Imported" with link to existing XBE thread rather than hiding. |
| Import as normal XBE thread | The whole point. Imported conversations must appear in the thread list, render messages, and be editable/resumable like native threads. | HIGH | Requires emitting `thread.created` + N `thread.message-sent` events into the event store. Maps role: user/assistant to `OrchestrationMessageRole`. No special "read-only" or "archived" state. |
| Import progress feedback | Importing 50 threads with thousands of messages each is slow. Users need to see it's working and how far along. | LOW | Progress bar or per-thread status indicator. Errors per thread shown inline, not as a modal blocker. |
| Error recovery per thread | Individual thread parse failures must not abort the entire batch. JSONL files can be corrupt or truncated (Codex appends in real time). | MEDIUM | Skip bad lines silently; show "partially imported (N messages recovered)" in result summary. |

### Differentiators (Competitive Advantage)

Features that set XBE Code apart. Not table stakes, but meaningfully valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Native resume through Codex app-server | Imported Codex threads store the original `providerThreadId`. On resume, XBE calls `thread/resume` with that ID instead of `thread/start`, giving the agent full original context — not just visible messages. No other GUI does this. | MEDIUM | Requires storing `providerThreadId` as thread metadata. `thread/resume` is already supported by Codex app-server JSON-RPC. Claude Code and Gemini CLI resume semantics differ — document per-provider. |
| Auto-discovery on project open | When user opens a project, proactively scan the provider history directories for matching workspace path and surface a badge/banner: "12 conversations found in Codex history — import?" No manual file picking. | MEDIUM | Server-side scan at project load time. Debounce; don't scan on every reconnect. Gate behind user preference (opt-in default or opt-out). |
| Provider-agnostic import surface | Single import UI covers Codex, Claude Code, and Gemini CLI. Users switching between agents get one consistent experience. No other tool in this space unifies all three. | HIGH | Each provider needs its own reader (Codex JSONL sessions, Claude Code project-scoped JSONL, Gemini CLI `logs.json`). Abstract behind a common `ProviderHistoryReader` interface. Complexity is additive — ship Codex first. |
| Message-level content fidelity | Import preserves full message text including code blocks, tool call summaries, and shell command records — not just user/assistant turn pairs. Activity log events (tool calls) can be mapped to `OrchestrationThreadActivity`. | HIGH | Codex JSONL contains structured tool call items. Claude Code history is rich JSONL per turn. This is optional per message — skip unmappable items rather than failing. |
| Relative-timestamp normalization | Provider timestamps are absolute UTC. Imported threads should show original timestamps so users can correlate with their git history. XBE already has `createdAt`/`updatedAt` on messages. | LOW | Preserve original timestamps from provider session files. This is about correctly mapping fields, not building anything new. |
| Import summary / audit trail | Show what was imported: N threads, M messages, K skipped (already existed). Persistent in a notification or dedicated import history panel. | LOW | Use XBE's existing notification system (`notification.created` channel). |

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Full bidirectional sync (live mirroring) | Users want their CLI history always reflected in XBE automatically. | Requires polling or file-watching `~/.codex/` in perpetuity. Race conditions when CLI is actively writing. Imported threads would get stale data. Complexity: HIGH, value: LOW. | One-time import on demand. Offer re-import for individual threads if needed. |
| Import all history (no workspace filter) | Users want everything in one place. | Users may have thousands of unrelated conversations. Importing all creates noise, slow initial load, and bloats the database. | Workspace-scoped discovery is the right default. Add "import from other projects" as a separate explicit action only if users demand it. |
| Editable imported history | Users want to clean up or redact messages before saving. | Editable pre-import state is a full text editor embedded in the import flow — enormous scope creep. Post-import editing via normal thread UX handles the legitimate case. | Allow deletion of individual messages from imported threads via normal thread UI after import. |
| Automated periodic re-import / background sync | "Always keep in sync" as a setting. | Silent background writes are hard to reason about. Creates phantom threads if provider IDs change. Difficult to explain to users why threads appeared. | Explicit user-triggered re-import. Surface discovery prompt on project open (see differentiators). |
| Exporting XBE threads back to provider format | "Round-trip" symmetry. | Provider formats are append-only JSONL with internal IDs. Writing back would require understanding each provider's internal schema. Out-of-scope for this milestone. | Not needed — XBE threads are the canonical record once imported. |
| Read-only / "archived" import mode | Keep imported threads as view-only so they don't "pollute" active threads. | Adds a new thread state the entire app must handle. Complexity: HIGH, user value: LOW (users want to continue conversations). | Import as normal resumable threads. Users can delete threads they don't want. |

---

## Feature Dependencies

```
[Workspace-path discovery]
    └──requires──> [Provider history readers (per-provider)]
                       └──requires──> [Codex reader: ~/.codex/sessions/ JSONL]
                       └──requires──> [Claude Code reader: ~/.claude/projects/ JSONL]
                       └──requires──> [Gemini CLI reader: ~/.gemini/tmp/ logs.json]

[Preview UI]
    └──requires──> [Workspace-path discovery]
    └──requires──> [Session metadata parsing (title, message count, date)]

[Selective import (checkboxes)]
    └──requires──> [Preview UI]

[Deduplication]
    └──requires──> [providerThreadId stored on XBE thread]
    └──requires──> [Provider history readers]

[Import as XBE thread]
    └──requires──> [Selective import]
    └──requires──> [Orchestration command: thread.create + thread.message-sent x N]
    └──requires──> [providerThreadId field on OrchestrationThread schema]

[Native resume (differentiator)]
    └──requires──> [Import as XBE thread]
    └──requires──> [providerThreadId stored on XBE thread]
    └──requires──> [Codex app-server thread/resume JSON-RPC call]

[Auto-discovery on project open (differentiator)]
    └──requires──> [Workspace-path discovery]
    └──enhances──> [Preview UI] (surfaces count, not full list)

[Provider-agnostic import (differentiator)]
    └──requires──> [Codex reader] (ship first)
    └──enhances──> [Claude Code reader, Gemini CLI reader] (add per provider)
```

### Dependency Notes

- **Native resume requires providerThreadId on thread schema**: This is a schema change in `packages/contracts/src/orchestration.ts` (`OrchestrationThread`, `ThreadCreatedPayload`, `ThreadCreateCommand`) and the corresponding server persistence layer. Must land before any import.
- **Provider readers are independent of each other**: Codex reader can ship without Claude Code or Gemini readers. Each reader is a self-contained module in `apps/server`.
- **Deduplication requires providerThreadId in the read model**: The server must index existing threads by `providerThreadId` to efficiently check for duplicates at import time.
- **Preview does not require full message parse**: Use session index files (Codex `~/.codex/sessions/` directory listing + thread title from `thread/list`, Claude Code `sessions-index.json`, Gemini session metadata) to render preview without reading full JSONL.

---

## MVP Definition

### Launch With (v1)

Minimum viable for this milestone — validates the core import loop.

- [ ] **providerThreadId schema extension** — Prerequisite for everything. Add optional `providerThreadId: string` to `OrchestrationThread`, `ThreadCreateCommand`, `ThreadCreatedPayload`. Required for deduplication and native resume.
- [ ] **Codex history reader (server-side)** — Read `~/.codex/sessions/` JSONL files, parse thread metadata and messages. Codex is the primary provider for XBE Code.
- [ ] **Workspace-path discovery for Codex** — Filter discovered sessions by `workingDirectory` matching the XBE project `workspaceRoot`.
- [ ] **WS method: `import.discover`** — New WebSocket method the client calls with a `projectId`. Server returns list of discovered provider threads with: `providerThreadId`, `title`, `providerKind`, `messageCount`, `createdAt`, `updatedAt`, `alreadyImported: bool`.
- [ ] **Preview + selective import UI** — Modal or drawer showing discovered threads in a checkbox list. Show title, date, message count, already-imported badge.
- [ ] **Import execution: thread.create + message rehydration** — Server import handler that emits orchestration events for selected threads. Per-thread error isolation — failed threads show error inline.
- [ ] **Deduplication check** — `alreadyImported` flag in discovery response. Do not create duplicate threads.

### Add After Validation (v1.x)

- [ ] **Claude Code reader** — Once Codex import is shipped and the pattern is proven.
- [ ] **Import summary notification** — Use existing notification system to confirm what was imported.
- [ ] **Auto-discovery badge on project open** — Surface "N conversations found" indicator after project loads.

### Future Consideration (v2+)

- [ ] **Gemini CLI reader** — Low maturity of Gemini CLI history format; wait for stabilization. (LOW confidence: Gemini CLI auto-save is a requested feature, not yet shipped stably as of March 2026.)
- [ ] **Native resume for Claude Code** — Claude Code resume semantics differ from Codex app-server (session-ID-based, not thread/resume JSON-RPC). Requires separate investigation.
- [ ] **Message-level activity import** — Import tool call activity log events, not just user/assistant messages. Significant parsing complexity per provider.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| providerThreadId schema extension | HIGH | LOW | P1 |
| Codex history reader | HIGH | MEDIUM | P1 |
| Workspace-path discovery | HIGH | LOW | P1 |
| `import.discover` WS method | HIGH | MEDIUM | P1 |
| Preview + selective import UI | HIGH | MEDIUM | P1 |
| Import execution (thread.create + messages) | HIGH | MEDIUM | P1 |
| Deduplication | HIGH | LOW | P1 |
| Import progress feedback | MEDIUM | LOW | P1 |
| Per-thread error isolation | MEDIUM | LOW | P1 |
| Claude Code reader | HIGH | MEDIUM | P2 |
| Import summary notification | LOW | LOW | P2 |
| Auto-discovery badge on project open | MEDIUM | LOW | P2 |
| Native resume via providerThreadId | HIGH | LOW | P2 |
| Gemini CLI reader | MEDIUM | HIGH | P3 |
| Message-level activity import | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1 import milestone
- P2: Add after v1 validated
- P3: Future consideration

---

## Competitor Feature Analysis

| Feature | Cursor (export-only) | VS Code Copilot (export-only) | Cody (export-only) | Our Approach |
|---------|----------------------|-------------------------------|---------------------|--------------|
| Conversation export | MD/HTML export via UI | JSON export via Command Palette | JSON export button | Not exporting — importing FROM provider CLIs |
| Import | Not offered | Not offered | Not offered | Full import into XBE threads — unique in space |
| Deduplication | N/A | N/A | N/A | providerThreadId index, "already imported" badge |
| Selective import | N/A | N/A | N/A | Checkbox per thread in preview modal |
| Resume after import | N/A | N/A | N/A | Codex app-server thread/resume with stored providerThreadId |
| Workspace filtering | N/A | N/A | N/A | Filter by project workspaceRoot — primary UX affordance |

No competitor offers import. All tools in the IDE extension space only export. XBE Code's import is the differentiating move.

---

## Sources

- Codex app-server protocol: https://developers.openai.com/codex/app-server/ (HIGH confidence — official docs)
- Codex session storage `~/.codex/sessions/`: https://dev.to/shinshin86/no-resume-in-codex-cli-so-i-built-one-quickly-continue-with-codex-history-list-50be and https://inventivehq.com/knowledge-base/openai/how-to-resume-sessions (MEDIUM — secondary sources, consistent with official changelog)
- Claude Code history storage `~/.claude/projects/`: https://kentgigger.com/posts/claude-code-conversation-history (MEDIUM — verified consistent with GitHub issue #9306)
- Gemini CLI session storage `~/.gemini/tmp/`: https://github.com/google-gemini/gemini-cli/discussions/4974 and https://github.com/google-gemini/gemini-cli/issues/5101 (MEDIUM — open issues confirm auto-save is a requested feature, not complete)
- Codex memory/SQLite system: https://deepwiki.com/openai/codex/3.7-memory-system (MEDIUM — secondary source, consistent with changelog reference to SQLite migration)
- Cursor export UX: https://cursor.com/docs/agent/chat/export (HIGH — official docs)
- VS Code chat export: https://code.visualstudio.com/docs/copilot/chat/chat-sessions (HIGH — official docs)
- Cody export: https://sourcegraph.com/blog/cody-vscode-0-10-release (MEDIUM — official blog)
- JetBrains AI history: https://www.jetbrains.com/help/ai-assistant/ai-chat.html (HIGH — official docs); export requested but not shipped: https://youtrack.jetbrains.com/projects/LLM/issues/LLM-314
- Slack import/export: https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools (HIGH — official docs)
- Data importer UX patterns: https://www.smashingmagazine.com/2020/12/designing-attractive-usable-data-importer-app/ (MEDIUM — authoritative UX source)
- XBE Code internal schema: `/home/danil.morozov/Workspace/t3code/packages/contracts/src/orchestration.ts` (HIGH — primary source)

---
*Feature research for: chat history import — XBE Code code-agent GUI*
*Researched: 2026-03-12*
