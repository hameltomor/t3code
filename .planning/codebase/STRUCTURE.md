# Codebase Structure

**Analysis Date:** 2026-03-12

## Directory Layout

```
t3code/
├── apps/                           # Application packages (monorepo workspaces)
│   ├── server/                     # Node.js WebSocket/HTTP server
│   │   ├── src/                    # TypeScript source
│   │   │   ├── main.ts             # CLI entry point + Effect layer composition
│   │   │   ├── wsServer.ts         # WebSocket/HTTP routing
│   │   │   ├── serverLayers.ts     # Provider & runtime service layer factories
│   │   │   ├── config.ts           # ServerConfig service definition
│   │   │   ├── provider/           # Provider adapters (Codex, Claude Code, Gemini)
│   │   │   ├── orchestration/      # Event engine & projections
│   │   │   ├── persistence/        # SQLite event store & projections
│   │   │   ├── git/                # Stacked Git workflow
│   │   │   ├── terminal/           # PTY management (Node/Bun)
│   │   │   ├── checkpointing/      # Diff storage & rollback
│   │   │   ├── push/               # Web push notifications
│   │   │   ├── telemetry/          # Analytics service
│   │   │   └── keybindings.ts      # Keybindings configuration
│   │   ├── integration/            # Integration tests
│   │   ├── dist/                   # Compiled output (git-ignored)
│   │   └── package.json            # Name: "xbe" (CLI binary)
│   │
│   ├── web/                        # React/Vite web UI
│   │   ├── src/
│   │   │   ├── main.tsx            # React entry point
│   │   │   ├── router.ts           # TanStack Router setup
│   │   │   ├── routes/             # Page routes (generated from file names)
│   │   │   │   ├── __root.tsx      # Root layout (sidebar, chat, diff panel)
│   │   │   │   ├── _chat.tsx       # Chat layout wrapper
│   │   │   │   ├── _chat.$threadId.tsx # Thread detail view
│   │   │   │   └── _chat.settings.tsx  # Settings page
│   │   │   ├── store.ts            # Zustand app state (projects, threads, models)
│   │   │   ├── wsNativeApi.ts      # WebSocket RPC client (NativeApi facade)
│   │   │   ├── wsTransport.ts      # WebSocket connection/message handling
│   │   │   ├── components/         # React components
│   │   │   │   ├── ui/             # Base UI primitives (button, input, etc.)
│   │   │   │   ├── ChatMarkdown.tsx    # Rendered conversation messages
│   │   │   │   ├── DiffPanel.tsx       # Git diff viewer
│   │   │   │   ├── GitActionsControl.tsx # Commit/push/PR UI
│   │   │   │   └── BranchToolbar.tsx   # Branch switching, stash UI
│   │   │   ├── hooks/              # React hooks (useTheme, useAppUpdate, etc.)
│   │   │   ├── lib/                # Utility modules (React Query integration, notifications)
│   │   │   ├── types.ts            # TypeScript type aliases
│   │   │   └── index.css           # Tailwind + app styles
│   │   ├── dist/                   # Built output (git-ignored)
│   │   └── package.json            # Name: "@xbetools/web"
│   │
│   ├── desktop/                    # Tauri desktop app wrapper
│   │   ├── src/                    # Tauri src (Rust + TypeScript)
│   │   ├── dist-electron/          # Packaged electron output (git-ignored)
│   │   └── package.json
│   │
│   └── marketing/                  # Astro marketing site
│       └── src/
│
├── packages/                       # Shared libraries (monorepo workspaces)
│   ├── contracts/                  # Schema definitions & type contracts
│   │   ├── src/
│   │   │   ├── index.ts            # Re-exports all contracts
│   │   │   ├── baseSchemas.ts      # Common schema types (ID, Error, etc.)
│   │   │   ├── ipc.ts              # Server CLI/RPC interface
│   │   │   ├── ws.ts               # WebSocket protocol (WsRequest, WsResponse, WsPush)
│   │   │   ├── provider.ts         # Provider types (ProviderKind, ProviderSession)
│   │   │   ├── providerRuntime.ts  # Provider events (ProviderRuntimeEvent)
│   │   │   ├── orchestration.ts    # Orchestration events & commands
│   │   │   ├── terminal.ts         # Terminal event types
│   │   │   ├── git.ts              # Git status & action types
│   │   │   ├── project.ts          # Project/workspace types
│   │   │   ├── server.ts           # Server configuration types
│   │   │   └── model.ts            # Model/provider metadata schemas
│   │   └── package.json            # Name: "@xbetools/contracts"
│   │
│   └── shared/                     # Shared runtime utilities (no barrel exports)
│       ├── src/
│       │   ├── model.ts            # Model slug resolution, provider metadata
│       │   ├── git.ts              # Git utility functions
│       │   ├── shell.ts            # Shell execution helpers
│       │   ├── logging.ts          # Logging utilities
│       │   └── Net.ts              # Network utilities (port finding)
│       └── package.json            # Name: "@xbetools/shared"
│
├── scripts/                        # Monorepo build/dev utilities
│   ├── cli.ts                      # Build orchestration
│   ├── dev-runner.ts               # Dev mode (server + web parallel)
│   └── build-desktop-artifact.ts   # Desktop packaging
│
├── .planning/                      # GSD planning/analysis documents
│   └── codebase/                   # Codebase maps (ARCHITECTURE.md, STRUCTURE.md, etc.)
│
├── .vscode/                        # VSCode settings
├── docs/                           # User/developer documentation
├── assets/                         # Marketing assets, icons
├── package.json                    # Root monorepo workspace config
├── tsconfig.json                   # TypeScript config
├── vite.config.ts                  # Vite config for web app
└── bun.lock                        # Bun lockfile
```

## Directory Purposes

**apps/server/src/provider:**
- Purpose: Provider adapter implementations (Codex, Claude Code, Gemini)
- Contains: Subprocess management, JSON-RPC marshaling, event normalization
- Key files:
  - `Services/ProviderService.ts` - Main service interface
  - `Services/ProviderAdapter.ts` - Abstract adapter contract
  - `Layers/CodexAdapter.ts` - Codex subprocess wrapper
  - `Layers/ClaudeCodeAdapter.ts` - Claude Code wrapper
  - `Layers/GeminiAdapter.ts` - Gemini wrapper
  - `Errors.ts` - Provider error types

**apps/server/src/orchestration:**
- Purpose: Event ingestion, command dispatch, projection generation
- Contains: OrchestrationEngine, OrchestrationReactor, projection pipeline
- Key files:
  - `Services/OrchestrationEngine.ts` - Command validator & dispatcher
  - `Services/OrchestrationReactor.ts` - Event consequence handler
  - `Services/ProjectionSnapshotQuery.ts` - Read model query interface
  - `Layers/ProjectionPipeline.ts` - Event-to-projection transformation
  - `Layers/ProviderRuntimeIngestion.ts` - Provider event projection

**apps/server/src/persistence:**
- Purpose: Event sourcing and projection snapshots
- Contains: SQLite schema, migrations, repository services
- Key files:
  - `Layers/Sqlite.ts` - SQLite connection & config
  - `Layers/OrchestrationEventStore.ts` - Event log repository
  - `Migrations/` - Database schema (001-016)
  - `Services/ProjectionThreads.ts`, `ProjectionTurns.ts`, etc. - Read model repositories

**apps/server/src/git:**
- Purpose: Stacked Git workflow orchestration
- Contains: High-level Git actions, external tool integration
- Key files:
  - `Services/GitManager.ts` - Public workflow interface (status, stacked actions)
  - `Services/GitCore.ts` - Low-level Git operations
  - `Services/GitService.ts` - Mid-level orchestration
  - `Layers/ForgeCliResolver.ts` - GitHub/GitLab CLI integration

**apps/server/src/terminal:**
- Purpose: PTY lifecycle management
- Contains: Process spawning, event streaming
- Key files:
  - `Services/Manager.ts` - Terminal session lifecycle
  - `Layers/Manager.ts` - Manager layer factory
  - `Layers/NodePTY.ts` - node-pty adapter
  - `Layers/BunPTY.ts` - Bun PTY adapter

**apps/server/src/checkpointing:**
- Purpose: Store and retrieve turn diffs for rollback
- Contains: Diff blob persistence, queries
- Key files:
  - `Services/CheckpointStore.ts` - Blob storage interface
  - `Services/CheckpointDiffQuery.ts` - Diff retrieval

**apps/web/src/components:**
- Purpose: React component tree
- Contains: Page layouts, chat rendering, diff viewer, Git actions
- Key subdirectories:
  - `ui/` - Base primitives (Button, Input, Dialog, etc.) from Base UI / custom
  - Root level: Feature components (ChatMarkdown, DiffPanel, GitActionsControl)

**apps/web/src/lib:**
- Purpose: Utility modules for common patterns
- Contains: React Query integrations, notification system, diff rendering, caching
- Key files:
  - `gitReactQuery.ts` - TanStack Query hooks for Git operations
  - `providerReactQuery.ts` - TanStack Query hooks for provider calls
  - `notifications.ts` - Toast/notification system
  - `turnDiffTree.ts` - Diff tree traversal/rendering

**packages/contracts/src:**
- Purpose: Schema definitions (schema-only, no runtime logic)
- Contains: Effect Schema validators for all domain types
- Key files:
  - `baseSchemas.ts` - Common ID, Error, Enum types
  - `provider.ts` - ProviderKind, ProviderSession, ProviderEvent schemas
  - `orchestration.ts` - OrchestrationEvent, OrchestrationCommand schemas
  - `ws.ts` - WebSocket protocol (WsRequest, WsResponse, WsPush)

**packages/shared/src:**
- Purpose: Shared runtime logic (no barrel exports - use subpath imports)
- Contains: Model resolution, Git helpers, logging, network utilities
- Import as: `@xbetools/shared/model`, `@xbetools/shared/git`, etc.

## Key File Locations

**Entry Points:**
- `apps/server/src/main.ts` - Server CLI bootstrap
- `apps/web/src/main.tsx` - React app entry
- `apps/web/src/router.ts` - TanStack Router factory
- `apps/web/src/routes/__root.tsx` - Root layout

**Configuration:**
- `apps/server/src/config.ts` - ServerConfig service (port, host, mode, auth)
- `apps/server/src/serverLayers.ts` - Effect layer composition
- `vite.config.ts` - Web app build config
- `tsconfig.json` - TypeScript compiler options

**Core Logic:**
- `apps/server/src/wsServer.ts` - WebSocket handler routing
- `apps/server/src/orchestration/Services/OrchestrationEngine.ts` - Command dispatcher
- `apps/web/src/store.ts` - Zustand global state
- `apps/web/src/wsNativeApi.ts` - RPC client factory

**Testing:**
- `apps/server/src/**/*.test.ts` - Unit tests (Vitest)
- `apps/server/integration/` - Integration tests
- `apps/web/src/**/*.test.ts` - Component/logic tests

## Naming Conventions

**Files:**
- `camelCase.ts` - Utility modules, logic
- `PascalCase.ts` - Class/service definitions (Services, Layers)
- `.logic.ts` - Pure functions extracted from components
- `.test.ts` - Test files (co-located with source)
- `_*.tsx` - Route files (TanStack Router convention)

**Directories:**
- `Layers/` - Effect Layer factories (one per service)
- `Services/` - Service interface definitions and implementations
- `components/` - React components (grouped by feature)
- `hooks/` - React hooks (custom behavior)
- `lib/` - Utility functions (non-React)
- `routes/` - File-based route definitions

**Services (Effect):**
- Defined as `class X extends ServiceMap.Service<X, XShape>()` with service tag `"xbe/*"`
- Layer defined as `X.layer` or `XLive` export
- Example: `export class GitManager extends ServiceMap.Service<GitManager, GitManagerShape>()` in `apps/server/src/git/Services/GitManager.ts`

**Contracts (Schemas):**
- Named as domain concepts, exported from `packages/contracts/src/index.ts`
- Example: `ProviderSession`, `OrchestrationEvent`, `WsRequest`

## Where to Add New Code

**New Feature in Server:**
- **Service Interface**: `apps/server/src/[domain]/Services/[Feature].ts`
- **Layer Factory**: `apps/server/src/[domain]/Layers/[Feature].ts`
- **Tests**: `apps/server/src/[domain]/[Feature].test.ts` (co-located)
- **Add to `serverLayers.ts`**: Import layer, merge into LayerLive composition

**New Component in Web:**
- **Component**: `apps/web/src/components/[Feature].tsx`
- **Logic extraction**: `apps/web/src/components/[Feature].logic.ts` (if >50 lines)
- **Hooks**: `apps/web/src/hooks/use[Feature].ts`
- **Tests**: `apps/web/src/components/[Feature].test.ts`
- **Route**: `apps/web/src/routes/[route].tsx` (if page-level)

**New Schema in Contracts:**
- **File**: `packages/contracts/src/[domain].ts`
- **Export**: Add to `packages/contracts/src/index.ts`
- **No runtime logic** - schema definitions only

**Shared Utilities:**
- **File**: `packages/shared/src/[utility].ts`
- **Export**: Named exports only (no barrel index)
- **Import as**: `@xbetools/shared/[utility]`

## Special Directories

**apps/server/attachments:**
- Purpose: Attachment blob storage (user-uploaded files, code snippets)
- Generated: Yes (runtime writes)
- Committed: No (.gitignore)

**apps/server/dist:**
- Purpose: Compiled JavaScript output
- Generated: Yes (`bun run build`)
- Committed: No

**apps/web/dist:**
- Purpose: Bundled React app (served as static assets by server)
- Generated: Yes (`bun run build`)
- Committed: No

**.turbo/:**
- Purpose: Turbo cache for fast rebuilds
- Generated: Yes
- Committed: No

**node_modules/:**
- Purpose: Installed dependencies (Bun managed)
- Generated: Yes (`bun install`)
- Committed: No

---

*Structure analysis: 2026-03-12*
