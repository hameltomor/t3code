# XBE Code — History Import

## What This Is

A history import system for XBE Code that lets users discover, preview, and selectively import existing conversations from Codex CLI and Claude Code into XBE Code. Imported conversations become normal XBE threads with external links back to the original provider session, supporting native resume (continue via original provider), lazy link validation, and thread provenance display. A 5-step import wizard provides provider filtering, transcript preview, import options, and immediate thread navigation.

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
- ✓ Discover importable conversations from Codex and Claude Code by workspace — v1.0
- ✓ Preview conversation transcript before importing — v1.0
- ✓ Selectively import conversations into normal XBE threads — v1.0
- ✓ Persist external link metadata in dedicated tables — v1.0
- ✓ Support native resume for Codex and Claude Code imported threads — v1.0
- ✓ Handle stale/missing provider-local state without destroying imported history — v1.0
- ✓ Import wizard UI with provider filtering, preview, and import options — v1.0
- ✓ Thread provenance display with lazy link validation and source badges — v1.0
- ✓ Fingerprint-based deduplication prevents duplicate imports — v1.0
- ✓ Streaming JSONL parsing stays under 10MB heap for 70MB files — v1.0
- ✓ Performance: scan <5s/100 sessions, preview <2s, import <10s/500 messages — v1.0

### Active

- [ ] Gemini CLI conversation import (deferred — format unstable)
- [ ] Support transcript-replay continuation for Gemini imported threads

### Out of Scope

- Automatic full-home-directory scan at startup — too invasive, privacy concern
- Live bidirectional sync with provider-local files — complexity not justified
- Mutation of provider-local state — read-only access only
- Guaranteed native resume for all imported threads — best-effort with validation
- Importing subagent/sidechain sessions — noise reduction, v2 consideration
- Worktree-aware workspace matching — v2 consideration

## Context

### Current State (v1.0 shipped)

- **Code:** ~5,600 LOC TypeScript across 70 files
- **Tech stack:** Effect (services/layers/schemas), SQLite, React + Zustand + React Query, WebSocket RPC
- **Providers:** Codex CLI (full support), Claude Code (full support), Gemini CLI (deferred)
- **DB tables:** `history_import_catalog`, `thread_external_links`, `provider_thread_id` column on `projection_threads`
- **Known issues:** Codex `state_5.sqlite` schema columns need validation against real installation

### Provider Storage Formats

- **Claude Code**: `~/.claude/projects/<encoded-path>/<session-id>.jsonl` — JSONL per event, optional `sessions-index.json` cache
- **Codex CLI**: `~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-*.jsonl` + `~/.codex/state_5.sqlite` index — JSONL events with SQLite metadata
- **Gemini CLI**: `~/.gemini/tmp/<project-slug>/chats/session-*.json` + `~/.gemini/projects.json` registry — single JSON files

### Implementation Reference

- Detailed spec: `tmp/history-import-implementation-spec.md`
- Codebase map: `.planning/codebase/`
- v1.0 milestone archive: `.planning/milestones/v1.0-ROADMAP.md`

## Constraints

- **Read-only access**: Never mutate provider-local files or databases
- **Privacy**: Never upload provider transcripts anywhere; all processing is local
- **Architecture**: Imported external link state lives in dedicated tables, not in `provider_session_runtime` or `projection_thread_sessions`
- **Performance**: Stream-parse large JSONL files (Claude Code sessions can be 70+ MB); cap preview messages
- **Existing patterns**: Follow Effect Service/Layer pattern, Effect Schema validation, existing migration conventions
- **Security**: No raw transcript content in server logs; scan for secrets before any persistence

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Imported threads become normal XBE threads | First-class citizen in read model, no duplicate rendering logic | ✓ Good — clean integration, no special rendering paths |
| Separate catalog + external link tables | Clean separation from runtime session state; import survives provider state changes | ✓ Good — clean boundaries, no schema conflicts |
| Three link modes (native-resume, transcript-replay, snapshot-only) | Different providers have different resume capabilities | ✓ Good — native resume works for Codex and Claude Code |
| Fingerprint-based deduplication | Deterministic identity for dedupe and stale-link detection | ✓ Good — reliable dedup and validation |
| Event-sourced import materialization | Imported messages go through orchestration engine for consistency | ✓ Good — imported threads are truly first-class |
| Codex-first implementation order | Hardest provider first validates architecture | ✓ Good — Claude Code added cleanly in one phase |
| Gemini deferred | Format too unstable (March 2026) | — Pending — re-evaluate when format stabilizes |
| Sequential message dispatch during import | Preserve ordering guarantees | ✓ Good — no ordering bugs |
| Two-phase import status (importing → valid) | Surface partial imports without silent deletion | ✓ Good — partial imports show warning badge |
| providerThreadId on OrchestrationThread | Enable dedup and native resume via read model | ⚠️ Revisit — required Phase 5.1 fix for in-memory projector propagation |

---
*Last updated: 2026-03-12 after v1.0 milestone*
