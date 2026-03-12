# Technology Stack

**Analysis Date:** 2026-03-12

## Languages

**Primary:**
- TypeScript 5.7.3 - Primary language for all app packages (server, web, desktop, shared contracts)
- JavaScript - Build scripts and configuration files

**Secondary:**
- HTML/CSS - Web UI with Tailwind CSS 4.0.0

## Runtime

**Environment:**
- Node.js 24.14.0 (required by monorepo package.json engines)
- Bun 1.3.9+ (primary package manager and runtime; used in dev and deployment)
- Electron 40.6.0 (desktop application framework)

**Package Manager:**
- Bun 1.3.9 - Monorepo package manager with workspace support
- Lockfile: `bun.lock` (present)

## Frameworks

**Core:**
- Effect (from custom PR build: `effect@8881a9b`) - Functional runtime, dependency injection, type-safe error handling
  - Used in: `apps/server`, `packages/contracts`, `packages/shared`
  - Provides: Effect/Effect, Layer, ServiceMap, Stream, Queue, Ref, Stream, Schema
- React 19.0.0 - UI framework (`apps/web`)
- TanStack React Router 1.160.2 - Client-side routing
- TanStack React Query 5.90.0 - Server state management
- Zustand 5.0.11 - Client state management

**Build/Dev:**
- Vite 8.0.0-beta.12 - Web bundler and dev server (`apps/web`)
- TurboRepo 2.3.3 - Monorepo orchestration
- Vitest 4.0.0 - Test runner (across all packages)
- Playwright 1.58.2 - Browser testing
- Babel React Compiler 19.0.0-beta - React optimization plugin

**Linting/Formatting:**
- OxLint 1.50.0 - Fast linting (Rust-based, replaces ESLint)
- OxFmt 0.35.0 - Fast formatting (Rust-based)

**Database/ORM:**
- SQLite (local state storage)
  - `@effect/sql-sqlite-bun` (Bun runtime) - Effect-based SQLite client
  - NodeSqliteClient (Node.js runtime fallback)
  - WAL journaling and foreign key constraints enabled

**CLI/Terminal:**
- node-pty 1.1.0 - PTY management for terminal emulation
- @xterm/xterm 6.0.0 - Terminal UI component
- open 10.1.0 - Cross-platform browser opener

**UI Components:**
- @base-ui/react 1.2.0 - Unstyled component library
- Lexical 0.41.0 - Rich text editor framework
- Lucide React 0.564.0 - Icon library
- Tailwind CSS 4.0.0 - Utility CSS framework with Vite plugin
- class-variance-authority 0.7.1 - Component style composition

**Content/Rendering:**
- @pierre/diffs 1.1.0-beta.16 - Diff visualization (React and worker components)
- react-markdown 10.1.0 - Markdown rendering
- remark-gfm 4.0.1 - GitHub Flavored Markdown support
- Fuse.js 7.1.0 - Fuzzy search library

**Utilities:**
- @tanstack/react-pacer 0.19.4 - Request batching/rate limiting
- @tanstack/react-virtual 3.13.18 - Virtual scrolling
- tailwind-merge 3.4.0 - Tailwind class merging
- TypeScript 5.7.3 - Type system and compilation

## Key Dependencies

**Critical (Provider Integrations):**
- `@anthropic-ai/claude-agent-sdk` 0.2.62 - Claude Code provider (wraps JSON-RPC stdio protocol)
- `@google/genai` 1.44.0 - Google Gemini API integration

**Infrastructure:**
- `ws` 8.18.0 - WebSocket server for client-server communication
- `web-push` 3.6.7 - Web Push Protocol for push notifications (VAPID key generation)
- `@effect/platform-node` (catalog) - Node.js platform abstraction layer for Effect
- `@effect/sql-sqlite-bun` (catalog) - SQLite database client for Effect runtime

**Monorepo Internal:**
- `@xbetools/contracts` (workspace) - Shared TypeScript schemas and event contracts
- `@xbetools/shared` (workspace) - Shared runtime utilities (git, logging, shell, Net, model)
- `@xbetools/web` (workspace) - React web application
- `xbe` (server CLI package, workspace) - Node.js server

## Configuration

**Environment:**
- Configuration via environment variables (CLI flags take precedence):
  - `XBECODE_MODE` - "web" or "desktop" runtime mode
  - `XBECODE_PORT` - HTTP/WebSocket server port (default: 3775)
  - `XBECODE_HOST` - Bind address (default: 127.0.0.1)
  - `XBECODE_STATE_DIR` - State directory for database, logs, config (default: `~/.xbe/`)
  - `XBECODE_AUTH_TOKEN` - WebSocket auth token for non-loopback binds
  - `XBECODE_NO_BROWSER` - Disable automatic browser opening
  - `XBECODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD` - Auto-create project for current directory
  - `XBECODE_LOG_WS_EVENTS` - Enable server-side WebSocket event logging
  - `VITE_DEV_SERVER_URL` - Dev server proxy URL for hot reload
  - `VITE_WS_URL` - WebSocket server URL for web app

**Build:**
- `vite.config.ts` (`apps/web`) - Web app bundler configuration
  - TanStack Router plugin integration
  - React Compiler Babel plugin
  - Tailwind CSS plugin
  - Service worker versioning plugin
  - HMR configured for Electron BrowserWindow
- `vitest.config.ts` (root) - Test runner config
- `tsconfig.base.json` - Base TypeScript compiler options (ES2023, strict mode)
- `.oxlintrc.json` - OxLint rules
- `.oxfmtrc.json` - OxFmt rules
- `turbo.json` - TurboRepo task configuration

## Platform Requirements

**Development:**
- Bun 1.3.9+
- Node.js 24.14.0 (for fallback when Bun unavailable)
- Supported platforms: macOS, Linux, Windows

**Production:**
- Electron 40.6.0 (desktop distribution)
- Web deployment: Any HTTP server (serves static React app from `apps/web/dist`)
- Server: Node.js 22.13+, 23.4+, or 24.10+ (flexible Node.js support)

---

*Stack analysis: 2026-03-12*
