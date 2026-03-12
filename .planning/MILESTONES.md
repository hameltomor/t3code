# Milestones

## v1.0 Chat History Import (Shipped: 2026-03-12)

**Phases completed:** 6 phases (1-5.1), 13 plans
**Timeline:** 2026-03-12 (~1.4 hours execution)
**Code:** 70 files changed, ~5,600 LOC TypeScript
**Git range:** `feat(01-01)` → `docs(phase-05.1)`

**Delivered:** End-to-end history import system enabling users to discover, preview, and selectively import Codex CLI and Claude Code conversations into XBE Code with native resume, thread provenance, and link validation.

**Key accomplishments:**
1. History import contract schemas, 3 database migrations, and Effect repository services (foundation layer)
2. Streaming Codex CLI import pipeline with JSONL parsing, context compaction handling, and fingerprint-based deduplication
3. 5-step import wizard UI with provider filtering, transcript preview, import options, and thread navigation
4. Claude Code import with sessions-index.json + JSONL header fallback, and native resume for both Codex and Claude Code providers
5. Thread provenance display with lazy link validation, source badges, sidebar filtering (All/Native/Imported)
6. Gap closure: projector providerThreadId propagation, badge comparison fix, validation status schema alignment

**Deferred:** Gemini CLI import (Phase 6) — upstream format unstable as of March 2026.

**Archives:**
- `milestones/v1.0-ROADMAP.md` — full phase details
- `milestones/v1.0-REQUIREMENTS.md` — requirement outcomes
- `milestones/v1.0-MILESTONE-AUDIT.md` — audit report

---

