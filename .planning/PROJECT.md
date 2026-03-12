# XBE Code — History Import

## What This Is

A history import system for XBE Code that lets users selectively discover, preview, and import existing conversations from Claude Code, Codex CLI, and Gemini CLI into XBE Code. Imported conversations become normal XBE threads with optional external links back to the original provider session for validation and native resume.

## Core Value

Users can bring their scattered code-agent conversation history into one unified place without losing context, and optionally continue those conversations through XBE Code's provider runtime.

## Requirements

### Validated

- Provider adapter architecture (Codex, Claude Code, Gemini) — existing
- Event-sourced orchestration engine with CQRS projections — existing
- SQLite persistence with Effect SQL and migration system — existing
- WebSocket RPC protocol with typed contracts — existing
- Thread/message/activity domain model — existing
- Provider session runtime persistence — existing
- Zustand + React Query client state management — existing

### Active

- [ ] Discover importable conversations from Claude Code, Codex, and Gemini by workspace
- [ ] Preview conversation transcript before importing
- [ ] Selectively import conversations into normal XBE threads
- [ ] Persist external link metadata separately from runtime session state
- [ ] Support native resume for Claude Code and Codex imported threads
- [ ] Support transcript-replay continuation for Gemini imported threads
- [ ] Handle stale/missing provider-local state without destroying imported history
- [ ] Import modal UI with provider filtering, preview, and import options

### Out of Scope

- Automatic full-home-directory scan at startup — too invasive, privacy concern
- Live bidirectional sync with provider-local files — complexity not justified for v1
- Mutation of provider-local state — read-only access only
- Guaranteed native resume for all imported threads — best-effort with validation
- Importing subagent/sidechain sessions — noise reduction, v2 consideration
- Worktree-aware workspace matching — v2 consideration

## Context

### Provider Storage Formats

- **Claude Code**: `~/.claude/projects/<encoded-path>/<session-id>.jsonl` — JSONL per event, optional `sessions-index.json` cache
- **Codex CLI**: `~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-*.jsonl` + `~/.codex/state_5.sqlite` index — JSONL events with SQLite metadata
- **Gemini CLI**: `~/.gemini/tmp/<project-slug>/chats/session-*.json` + `~/.gemini/projects.json` registry — single JSON files

### Existing XBE Architecture

- Event-sourced orchestration engine processes commands into immutable events
- Projections denormalize events into SQLite read-model tables
- Provider adapters abstract Codex/Claude Code/Gemini behind unified ProviderService
- `provider_session_runtime` table manages XBE-owned recoverable sessions
- `projection_thread_sessions` is read-model only — no external link state there
- Effect Service/Layer pattern for dependency injection throughout

### Implementation Reference

- Detailed spec: `tmp/history-import-implementation-spec.md`
- Codebase map: `.planning/codebase/`

## Constraints

- **Read-only access**: Never mutate provider-local files or databases
- **Privacy**: Never upload provider transcripts anywhere; all processing is local
- **Architecture**: Imported external link state must live in dedicated tables, not in `provider_session_runtime` or `projection_thread_sessions`
- **Performance**: Stream-parse large JSONL files (Claude Code sessions can be 70+ MB); cap preview messages
- **Existing patterns**: Follow Effect Service/Layer pattern, Effect Schema validation, existing migration conventions
- **Security**: No raw transcript content in server logs; scan for secrets before any persistence

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Imported threads become normal XBE threads | First-class citizen in read model, no duplicate rendering logic | — Pending |
| Separate catalog + external link tables | Clean separation from runtime session state; import survives provider state changes | — Pending |
| Three link modes (native-resume, transcript-replay, snapshot-only) | Different providers have different resume capabilities | — Pending |
| Fingerprint-based deduplication | Deterministic identity for dedupe and stale-link detection | — Pending |
| Event-sourced import materialization | Imported messages go through orchestration engine for consistency | — Pending |

---
*Last updated: 2026-03-12 after initialization*
