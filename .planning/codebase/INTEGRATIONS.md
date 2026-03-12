# External Integrations

**Analysis Date:** 2026-03-12

## APIs & External Services

**AI/Code Providers:**
- Claude Code (Anthropic)
  - SDK: `@anthropic-ai/claude-agent-sdk` 0.2.62
  - Protocol: JSON-RPC over stdin/stdout
  - Implementation: `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts`
  - Features: Query sessions, MCP server discovery from `~/.claude.json`, approval request handling
  - Auth: Managed by Anthropic CLI; MCP configs from local user directory

- Gemini (Google)
  - SDK: `@google/genai` 1.44.0
  - Protocol: REST API via @google/genai SDK
  - Implementation: `apps/server/src/provider/Layers/GeminiAdapter.ts`
  - Auth: API key in environment (provider-specific)

- Codex (OpenAI)
  - Protocol: JSON-RPC over stdio (same as Claude Code)
  - Implementation: `apps/server/src/provider/Layers/CodexAdapter.ts`
  - Status: Legacy provider, actively maintained for compatibility

## Data Storage

**Databases:**
- SQLite (local filesystem)
  - Connection: File-based at `~/.xbe/state.sqlite`
  - Client: `@effect/sql-sqlite-bun` (Bun) or Node.js fallback
  - Schema: Managed via migrations in `apps/server/src/persistence/Migrations/`
  - Features: WAL journaling, foreign key constraints enabled
  - Scope: Project metadata, sessions, checkpoints, drafts, push subscriptions, notifications

**File Storage:**
- Local filesystem only
  - State directory: `~/.xbe/` (configurable via `XBECODE_STATE_DIR`)
  - Subdirectories:
    - `state.sqlite` - SQLite database
    - `logs/provider/` - Provider event logs (NDJSON format)
    - `keybindings.json` - User keybinding configuration
    - `vapid-keys.json` - Web Push VAPID key pair (auto-generated)

**Caching:**
- Service Worker caching (web app):
  - `xbe-offline-v${version}` - Offline fallback
  - `xbe-app-shell-v${version}` - Application shell caching
- localStorage (browser):
  - `xbecode:*` - Key prefix for client state persistence
  - Stored data: Theme preference, last editor, last invoked script, composer draft

## Authentication & Identity

**Auth Providers:**
- Custom token-based (optional)
  - Env var: `XBECODE_AUTH_TOKEN`
  - Used for: WebSocket connections on non-loopback binds
  - Requirement: Enforced only when binding to non-loopback hosts (0.0.0.0, `::`), or override with auth token
- Local system auth (desktop mode):
  - Electron app runs as logged-in user process
  - File-based access controls via OS permissions

**Provider-Specific Auth:**
- Claude Code: Managed by Anthropic CLI (`~/.anthropic/` or `~/.claude.json`)
- Gemini: API key passed to SDK (env var-driven, provider-specific configuration)
- Codex: JSON-RPC session management via stdio

## Monitoring & Observability

**Error Tracking:**
- None detected - custom logging infrastructure only

**Logs:**
- Server logs: Effect framework's built-in logger
  - Configuration: Levels controlled via Effect runtime
  - Startup logs: Server bind address, port, mode, auth status
- Provider logs: NDJSON format to `~/.xbe/logs/provider/events.log`
  - Two streams: `native` (provider SDK events) and `canonical` (normalized events)
  - Conditional logging: Controlled by `XBECODE_LOG_WS_EVENTS` or presence of `VITE_DEV_SERVER_URL`
- Web logs: Browser console (Effect runtime logs, application state)

**Telemetry:**
- Anonymous event tracking via `AnalyticsService` (`apps/server/src/telemetry/`)
  - Service: Effect-based optional analytics
  - Events tracked: `server.boot.heartbeat` (thread count, project count on startup)
  - Implementation: `apps/server/src/telemetry/Layers/AnalyticsService.ts`
  - Note: Infrastructure exists but destination not externally visible in code; see implementation

## CI/CD & Deployment

**Hosting:**
- Web deployment: Static HTTP server
  - Build output: `apps/web/dist/`
  - Entry: `index.html` with React app bundle
  - Service worker: `sw.js` (installed on page load)
  - Manifest: `manifest.webmanifest` (PWA metadata)

- Server deployment: Node.js or Bun runtime
  - CLI package: `xbe` (bin: `dist/index.mjs`)
  - Start command: `xbe --port 3775 --host 127.0.0.1`
  - Environment: Configurable via env vars or CLI flags

- Desktop deployment: Electron bundle
  - Build output: `apps/desktop/dist-electron/`
  - Main process: `main.js` (launches XBE server + Electron window)
  - Updater: `electron-updater` 6.6.2
  - Target platforms: macOS (DMG), Linux (AppImage), Windows (NSIS)

**CI Pipeline:**
- No detected CI service (GitHub Actions config exists but no workflow files in scope)
- Local release scripts: `bash scripts/release-local.sh`
- Build orchestration: TurboRepo task runner

## Environment Configuration

**Required env vars:**
- `XBECODE_STATE_DIR` - State directory (optional; defaults to `~/.xbe/`)
- Provider API keys (if using Gemini) - provider-specific setup

**Optional env vars:**
- `XBECODE_MODE` - "web" or "desktop" (default: "web")
- `XBECODE_PORT` - HTTP/WebSocket port (default: 3775, auto-find if desktop)
- `XBECODE_HOST` - Bind address (default: 127.0.0.1)
- `XBECODE_AUTH_TOKEN` - WebSocket auth token for non-loopback binds
- `XBECODE_NO_BROWSER` - Skip automatic browser opening (desktop only)
- `XBECODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD` - Create project from cwd (default: true for web)
- `XBECODE_LOG_WS_EVENTS` - Enable WebSocket event logging (default: true if `VITE_DEV_SERVER_URL` set)
- `VITE_DEV_SERVER_URL` - Dev server URL for hot module reload
- `VITE_WS_URL` - WebSocket server URL override (dev mode)

**Secrets location:**
- `.env` files (not committed) - Local development only
- `~/.xbe/` - Auto-generated VAPID keys for Web Push
- `XBECODE_AUTH_TOKEN` - Command-line arg or env var (keep in secure storage)
- Provider credentials: Managed by provider-specific CLI tools (Anthropic, Google)

## Webhooks & Callbacks

**Incoming:**
- None detected - XBE Code is a client, not a provider

**Outgoing:**
- Web Push notifications (`web-push` 3.6.7)
  - Destination: User's browser push endpoints (stored in SQLite)
  - Payload: Title, body, notification ID, thread ID
  - Protocol: Web Push Protocol (W3C standard)
  - VAPID: Auto-generated and stored at `~/.xbe/vapid-keys.json`
  - Use case: Notifying user of provider activity (async updates)

**Pub/Sub:**
- WebSocket push channel: `orchestration.domainEvent`
  - Source: Server-side orchestration events
  - Clients: Web app (and desktop Electron renderer)
  - Content: Normalized provider runtime events, command receipts, projections

## MCP Integration

**Model Context Protocol (MCP):**
- Claude Code discovers MCP servers from local configuration
  - Source: `~/.claude.json` (Anthropic CLI config)
  - Discovery: Implemented in `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts`
  - Type: `McpServerConfig` from SDK
  - Use: MCP servers are passed to Claude Code query sessions

---

*Integration audit: 2026-03-12*
