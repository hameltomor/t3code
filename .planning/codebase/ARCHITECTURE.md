# Architecture

**Analysis Date:** 2026-03-12

## Pattern Overview

**Overall:** Multi-tier distributed architecture with effect-based dependency injection on the server, streaming event-driven state synchronization, and client-side Zustand/React Query state management.

**Key Characteristics:**
- Server uses Effect TypeScript library for service composition, error handling, and resource management
- Events sourced from provider subprocess (Codex) via JSON-RPC over stdio, streamed to browser via WebSocket
- Orchestration engine projects domain events into queryable read models
- Web app manages local session/conversation state with WebSocket as source of truth
- Desktop app wraps web app in Tauri with service worker for offline support

## Layers

**Provider Adapters Layer:**
- Purpose: Abstracts multiple code generation providers (Codex, Claude Code, Gemini)
- Location: `apps/server/src/provider/Layers/`, `apps/server/src/provider/Services/`
- Contains: Provider-specific subprocess managers, JSON-RPC marshaling, event normalization
- Depends on: Effect, Node.js child_process, provider CLI tools
- Used by: ProviderService, OrchestrationEngine

**Orchestration Layer:**
- Purpose: Coordinates provider event ingestion, command dispatch, and projection generation
- Location: `apps/server/src/orchestration/Services/`, `apps/server/src/orchestration/Layers/`
- Contains: OrchestrationEngine (command processing), OrchestrationReactor (event cascading), ProjectionPipeline (read model projection)
- Depends on: OrchestrationEventStore, ProviderService, CheckpointReactor
- Used by: WebSocket server, external command systems

**Persistence Layer:**
- Purpose: Event store and projection snapshots using SQLite
- Location: `apps/server/src/persistence/Layers/`, `apps/server/src/persistence/Services/`
- Contains: OrchestrationEventStore (event log), ProjectionThreadMessages, ProjectionTurns, ProjectionState, etc.
- Depends on: Effect SQL bindings, SQLite
- Used by: OrchestrationEngine, ProjectionSnapshotQuery, all domain services

**Git/Stacked Workflow Layer:**
- Purpose: Abstracts stacked Git operations with external tool integrations
- Location: `apps/server/src/git/Services/`, `apps/server/src/git/Layers/`
- Contains: GitManager (high-level workflow), GitCore (low-level operations), ForgeCliResolver (GitHub/GitLab integration)
- Depends on: Shell execution, external CLI tools (gh, git, forge)
- Used by: WebSocket handlers

**Terminal Layer:**
- Purpose: PTY management for both Node.js and Bun runtimes
- Location: `apps/server/src/terminal/Services/`, `apps/server/src/terminal/Layers/`
- Contains: TerminalManager (lifecycle), PTY adapters (NodePTY, BunPTY)
- Depends on: node-pty, Bun PTY APIs
- Used by: WebSocket server for terminal session routing

**Checkpoint/Diff Storage:**
- Purpose: Stores and queries Git diff blobs for conversation rollback
- Location: `apps/server/src/checkpointing/Services/`, `apps/server/src/checkpointing/Layers/`
- Contains: CheckpointStore (blob persistence), CheckpointDiffQuery (diff retrieval)
- Depends on: Persistence layer, diff parsing
- Used by: Provider rollback operations

**HTTP/WebSocket Server Layer:**
- Purpose: Routes client requests to domain services, streams events to connected sessions
- Location: `apps/server/src/wsServer.ts`
- Contains: WebSocket routing, static asset serving, authentication, message marshaling
- Depends on: All service layers, Node.js http
- Used by: Web/Desktop client

**Web UI Layer:**
- Purpose: React application for session/conversation management and file editing
- Location: `apps/web/src/`
- Contains: Page routes, component tree, Zustand stores, React Query hooks
- Depends on: TanStack Router, React Query, Zustand, WebSocket transport
- Used by: Electron/browser runtime

## Data Flow

**Provider Turn Flow (User → Codex → Persisted):**

1. User submits chat message via web UI
2. Web sends `provider.sendTurn` RPC call over WebSocket
3. Server routes to ProviderService
4. ProviderService selects adapter (Codex/Claude Code/Gemini), spawns/resumes subprocess
5. Subprocess executes plan, emits structured events (JSON-RPC, one-per-line)
6. OrchestrationEngine reads provider events, wraps in ProviderRuntimeEvent schema
7. Events persisted to OrchestrationEventStore
8. ProviderRuntimeIngestion reactor projects events into domain read models
9. Projections (ProjectionThreadMessages, ProjectionTurns) updated
10. CheckpointReactor stores turn diff blobs if changed
11. Server streams ProviderRuntimeEvent via WebSocket push on `orchestration.domainEvent`
12. Web app receives, updates Zustand stores and React Query cache

**Orchestration Command Flow (User → Server Decision):**

1. User initiates action (e.g., "commit and push") via web UI
2. Web sends `orchestration.executeCommand` RPC
3. Server validates via OrchestrationEngine
4. Engine dispatches specialized reactors (e.g., ProviderCommandReactor for provider requests)
5. Reactors execute side effects (Git operations, provider requests)
6. Results published back via WebSocket push
7. Web app receives confirmation, updates UI state

**Projection Snapshot Flow (Query-Time):**

1. Web app mounts component needing project/thread state
2. React Query calls `ProjectionSnapshotQuery.getSnapshot()`
3. Query rebuilds read model from OrchestrationEventStore events
4. Snapshot cached in memory until next event
5. Returned to component, projected into Zustand for UI rendering

**State Management:**

- **Server**: Event-sourced (OrchestrationEventStore), projections cached in-memory during request
- **Web**: Zustand for UI-only state (selection, expanded items); React Query for server-sourced snapshots
- **Sync**: WebSocket push on `orchestration.domainEvent` keeps web synchronized after server mutations

## Key Abstractions

**ProviderService:**
- Purpose: Unified interface across provider adapters
- Examples: `apps/server/src/provider/Services/ProviderService.ts`, `apps/server/src/provider/Layers/CodexAdapter.ts`
- Pattern: Effect ServiceMap.Service with error union types (CodexError | SessionError | ValidationError)

**OrchestrationEngine:**
- Purpose: Validates commands and coordinates provider/git/terminal actions
- Examples: `apps/server/src/orchestration/Services/OrchestrationEngine.ts`
- Pattern: Stateless command processor, emits events to OrchestrationEventStore

**ProjectionSnapshotQuery:**
- Purpose: Read-only query interface for computed state (threads, projects, sessions, etc.)
- Examples: `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts`
- Pattern: Rebuilds from event log, caches during request scope

**Effect Layer/Service Pattern:**
- Purpose: Dependency injection and error propagation throughout stack
- Examples: Every `Layers/*.ts` and `Services/*.ts` file
- Pattern: Services defined via `ServiceMap.Service`, layers via `Layer.effect`, composed in `serverLayers.ts`

**WebSocket NativeApi:**
- Purpose: Client-side RPC interface to server
- Examples: `apps/web/src/wsNativeApi.ts`, `apps/web/src/wsTransport.ts`
- Pattern: Schemas from @xbetools/contracts, message queuing with request/response matching

## Entry Points

**Server CLI Entry:**
- Location: `apps/server/src/main.ts`
- Triggers: `bun run dev` / `npm start` / `xbe` CLI command
- Responsibilities: Parses flags, builds Effect layers, starts HTTP/WebSocket listeners

**Server HTTP/WebSocket:**
- Location: `apps/server/src/wsServer.ts`
- Triggers: Client WebSocket connection, HTTP GET/POST
- Responsibilities: Routes to domain services, streams provider events, serves static web assets

**Web App Entry:**
- Location: `apps/web/src/main.tsx`
- Triggers: Browser load
- Responsibilities: Creates React Router, establishes WebSocket, initializes Zustand/React Query

**Codex AppServer Subprocess:**
- Location: Spawned by `apps/server/src/codexAppServerManager.ts`
- Triggers: User creates/resumes provider session
- Responsibilities: Runs `codex app-server`, marshals JSON-RPC over stdio

## Error Handling

**Strategy:** Typed error unions propagated through Effect, discriminated at handler boundaries.

**Patterns:**
- Provider layer: CodexError | SessionError | ValidationError (defined in `apps/server/src/provider/Errors.ts`)
- Orchestration layer: OrchestrationError variants (defined in `apps/server/src/orchestration/`)
- Git layer: GitManagerServiceError | GitServiceError (defined in `apps/server/src/git/Errors.ts`)
- Web handlers: Catch-and-log with user notification via toast (e.g., `apps/web/src/lib/notifications.ts`)

**Error Propagation:**
- Effect errors caught at WebSocket handler boundary in `wsServer.ts`
- Converted to WsResponse with error payload
- Client receives error, shows toast notification
- Critical errors (auth, connection) escalate to error boundary

## Cross-Cutting Concerns

**Logging:**
- Server: Effect.logInfo/Warning/Error + structured context
- Web: console.log/error with breadcrumbs stored in memory for debugging

**Validation:**
- Server: Schema validation on all RPC inputs via Effect Schema
- Web: PropTypes on components, local form validation before sending

**Authentication:**
- Server: WebSocket auth token check on non-loopback binds (see `apps/server/src/config.ts`)
- Web: Token passed in connection headers, re-validated per request (desktop mode passes system auth)

**Resource Cleanup:**
- Server: Effect Scope manages provider subprocess lifecycle, terminal cleanup on disconnect
- Web: React effect cleanup removes WebSocket listeners, cancels pending requests on unmount

---

*Architecture analysis: 2026-03-12*
