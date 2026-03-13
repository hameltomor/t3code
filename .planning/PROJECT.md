# XBE Code

## What This Is

A minimal web GUI for using code agents like Codex and Claude Code. XBE Code wraps provider runtimes (Codex app-server, Claude Code SDK, Gemini API) behind an event-sourced orchestration engine, serving a React UI over WebSocket. Features include multi-provider session management, conversation history import, real-time session context tracking, and live context window usage display.

## Core Value

Users can interact with multiple code agents through one unified interface without losing context, visibility, or control over their coding sessions.

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
- ✓ Session context status: live context window usage tracking for all providers — v1.1
- ✓ Context window registry with model-specific token limits — v1.1
- ✓ Provider-normalized usage events (Codex native, Claude derived, Gemini computed) — v1.1
- ✓ Thread-scoped context status projection in orchestration pipeline — v1.1
- ✓ Composer footer context status UI (minimal badge + full pill modes) — v1.1

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
- Rate limit display in context pill — separate concern, different update cadence
- Cost tracking in context pill — different domain, requires price-per-token data
- Browser-side token counting — architecture requires server-side normalization
- Per-message token attribution — context status is thread-scoped, not message-scoped
- Automatic compaction trigger from UI — provider controls compaction; UI is read-only observer
- Settings UI for display mode toggle — component supports mode prop; settings page deferred

## Context

### Current State (v1.1 shipped)

- **Code:** ~11,300 LOC TypeScript across ~126 files
- **Tech stack:** Effect (services/layers/schemas), SQLite, React + Zustand + React Query, WebSocket RPC
- **Providers:** Codex CLI (full support), Claude Code (full support), Gemini CLI (deferred)
- **DB tables:** 20 projection tables including `projection_thread_context_status`
- **v1.1 additions:** 56 files changed, +5,721 LOC for context status pipeline (schemas, normalization, ingestion, projection, persistence, UI)
- **Known issues:** Codex `state_5.sqlite` schema columns need validation against real installation; GPT-5.x and Gemini 3.x preview model context limits are medium confidence

### Provider Storage Formats

- **Claude Code**: `~/.claude/projects/<encoded-path>/<session-id>.jsonl` — JSONL per event, optional `sessions-index.json` cache
- **Codex CLI**: `~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-*.jsonl` + `~/.codex/state_5.sqlite` index — JSONL events with SQLite metadata
- **Gemini CLI**: `~/.gemini/tmp/<project-slug>/chats/session-*.json` + `~/.gemini/projects.json` registry — single JSON files

### Implementation Reference

- Detailed spec: `tmp/history-import-implementation-spec.md`
- Codebase map: `.planning/codebase/`
- v1.0 milestone archive: `.planning/milestones/v1.0-ROADMAP.md`
- v1.1 milestone archive: `.planning/milestones/v1.1-ROADMAP.md`

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
| Separate thread context projection | Context status and session lifecycle are different domains with different update frequencies | ✓ Good — clean separation, supplementary projection |
| ContextWindowRegistry for model limits | Avoid scattering token-limit constants across adapters and UI; single resolver with fallback chain | ✓ Good — pure functions, no side effects |
| Provider support labels (native/derived-live/derived-on-demand) | Honest about precision differences; users should not assume equal accuracy across providers | ✓ Good — UI labels show support tier |
| Minimal badge default, full pill as option | Start minimal, extensible to settings-controlled mode later | ✓ Good — feature-flagged full pill for internal use |
| Pure logic/view separation for UI | All derivation in .logic.ts, component is thin render layer | ✓ Good — fully testable, 19 unit tests |
| 500ms debounce on display object | Prevents visual flicker without blocking data flow | ✓ Good — smooth UX under rapid updates |
| Compaction detection via 80% threshold | current totalTokens < previous * 0.8 triggers compacted state | ✓ Good — reliable detection without false positives |

---
*Last updated: 2026-03-13 after v1.1 milestone*
