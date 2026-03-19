import { Fragment, type ReactNode, createElement, useCallback, useEffect } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProjectId,
  type ProviderKind,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@xbetools/contracts";
import {
  inferProviderForModel,
  resolveModelSlug,
  resolveModelSlugForProvider,
} from "@xbetools/shared/model";
import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { type ChatMessage, type Project, type Thread } from "./types";

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  threadsHydrated: boolean;
  /** UI-only: selected repo cwd per project for multi-repo workspaces. Not persisted to server. */
  selectedRepoCwdByProject: Record<string, string>;
}

const PERSISTED_STATE_KEY = "xbecode:renderer-state:v8";
const LEGACY_PERSISTED_STATE_KEYS = [
  "xbecode:renderer-state:v7",
  "xbecode:renderer-state:v6",
  "xbecode:renderer-state:v5",
  "xbecode:renderer-state:v4",
  "xbecode:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

const initialState: AppState = {
  projects: [],
  threads: [],
  threadsHydrated: false,
  selectedRepoCwdByProject: {},
};
const persistedExpandedProjectCwds = new Set<string>();
const persistedModelByProjectCwd = new Map<string, string>();
let persistedProjectOrder: string[] = [];

// ── Persist helpers ──────────────────────────────────────────────────

function readPersistedState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as {
      expandedProjectCwds?: string[];
      modelByProjectCwd?: Record<string, string>;
      projectOrder?: string[];
    };
    persistedExpandedProjectCwds.clear();
    for (const cwd of parsed.expandedProjectCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedExpandedProjectCwds.add(cwd);
      }
    }
    persistedModelByProjectCwd.clear();
    for (const [cwd, model] of Object.entries(parsed.modelByProjectCwd ?? {})) {
      if (typeof cwd === "string" && cwd.length > 0 && typeof model === "string" && model.length > 0) {
        persistedModelByProjectCwd.set(cwd, model);
      }
    }
    persistedProjectOrder = [];
    for (const cwd of parsed.projectOrder ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedProjectOrder.push(cwd);
      }
    }
    return { ...initialState };
  } catch {
    return initialState;
  }
}

function persistState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds: state.projects
          .filter((project) => project.expanded)
          .map((project) => project.cwd),
        modelByProjectCwd: Object.fromEntries(
          state.projects.map((project) => [project.cwd, project.model]),
        ),
        projectOrder: persistedProjectOrder,
      }),
    );
    for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
      window.localStorage.removeItem(legacyKey);
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}
const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
): Project[] {
  return incoming.map((project) => {
    const existing =
      previous.find((entry) => entry.id === project.id) ??
      previous.find((entry) => entry.cwd === project.workspaceRoot);
    return {
      id: project.id,
      name: project.title,
      cwd: project.workspaceRoot,
      model:
        existing?.model ??
        persistedModelByProjectCwd.get(project.workspaceRoot) ??
        resolveModelSlug(project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex),
      expanded:
        existing?.expanded ??
        (persistedExpandedProjectCwds.size > 0
          ? persistedExpandedProjectCwds.has(project.workspaceRoot)
          : true),
      scripts: project.scripts.map((script) => ({ ...script })),
      workspaceMembers: [...(project.workspaceMembers ?? [])],
    };
  });
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName === "codex" || providerName === "claudeCode" || providerName === "gemini") {
    return providerName;
  }
  return "codex";
}

function inferProviderForThreadModel(input: {
  readonly model: string;
  readonly sessionProviderName: string | null;
}): ProviderKind {
  if (
    input.sessionProviderName === "codex" ||
    input.sessionProviderName === "claudeCode" ||
    input.sessionProviderName === "gemini"
  ) {
    return input.sessionProviderName;
  }
  return inferProviderForModel(input.model) ?? "codex";
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = mapProjectsFromReadModel(
    readModel.projects.filter((project) => project.deletedAt === null),
    state.projects,
  );
  const existingThreadById = new Map(state.threads.map((thread) => [thread.id, thread] as const));
  const threads = readModel.threads
    .filter((thread) => thread.deletedAt === null)
    .map((thread) => {
      const existing = existingThreadById.get(thread.id);
      return {
        id: thread.id,
        codexThreadId: null,
        providerThreadId: thread.providerThreadId ?? null,
        projectId: thread.projectId,
        title: thread.title,
        model: resolveModelSlugForProvider(
          inferProviderForThreadModel({
            model: thread.model,
            sessionProviderName: thread.session?.providerName ?? null,
          }),
          thread.model,
        ),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        session: thread.session
          ? {
              provider: toLegacyProvider(thread.session.providerName),
              status: toLegacySessionStatus(thread.session.status),
              orchestrationStatus: thread.session.status,
              activeTurnId: thread.session.activeTurnId ?? undefined,
              createdAt: thread.session.updatedAt,
              updatedAt: thread.session.updatedAt,
              ...(thread.session.lastError ? { lastError: thread.session.lastError } : {}),
            }
          : null,
        messages: thread.messages.map((message) => {
          const attachments = message.attachments?.map((attachment) => {
            if (attachment.type === "file") {
              return {
                type: "file" as const,
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
              };
            }
            return {
              type: "image" as const,
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
            };
          });
          const normalizedMessage: ChatMessage = {
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            streaming: message.streaming,
            ...(message.streaming ? {} : { completedAt: message.updatedAt }),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          };
          return normalizedMessage;
        }),
        proposedPlans: thread.proposedPlans.map((proposedPlan) => ({
          id: proposedPlan.id,
          turnId: proposedPlan.turnId,
          planMarkdown: proposedPlan.planMarkdown,
          createdAt: proposedPlan.createdAt,
          updatedAt: proposedPlan.updatedAt,
        })),
        error: thread.session?.lastError ?? null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        latestTurn: thread.latestTurn,
        lastVisitedAt: existing?.lastVisitedAt ?? thread.updatedAt,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        worktreeEntries: [...(thread.worktreeEntries ?? [])],
        turnDiffSummaries: thread.checkpoints.map((checkpoint) => ({
          turnId: checkpoint.turnId,
          completedAt: checkpoint.completedAt,
          status: checkpoint.status,
          assistantMessageId: checkpoint.assistantMessageId ?? undefined,
          checkpointTurnCount: checkpoint.checkpointTurnCount,
          checkpointRef: checkpoint.checkpointRef,
          files: checkpoint.files.map((file) => ({ ...file })),
        })),
        activities: thread.activities.map((activity) => ({ ...activity })),
        contextStatus: thread.contextStatus ?? null,
      };
    });
  return {
    ...state,
    projects,
    threads,
    threadsHydrated: true,
  };
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const threads = updateThread(state.threads, threadId, (thread) => {
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  const threads = updateThread(state.threads, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.error === error) return t;
    return { ...t, error };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setProjectModel(
  state: AppState,
  projectId: Project["id"],
  model: string,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.model === model) return p;
    changed = true;
    return { ...p, model };
  });
  return changed ? { ...state, projects } : state;
}

export function setSelectedRepoCwd(
  state: AppState,
  projectId: Project["id"],
  repoCwd: string | null,
): AppState {
  if (repoCwd === null) {
    if (!(projectId in state.selectedRepoCwdByProject)) return state;
    const next = { ...state.selectedRepoCwdByProject };
    delete next[projectId];
    return { ...state, selectedRepoCwdByProject: next };
  }
  if (state.selectedRepoCwdByProject[projectId] === repoCwd) return state;
  return {
    ...state,
    selectedRepoCwdByProject: { ...state.selectedRepoCwdByProject, [projectId]: repoCwd },
  };
}

/**
 * Optimistically inserts a minimal thread into the main store so the route
 * guard sees it immediately after the draft is cleared. The next server
 * snapshot sync will overwrite this placeholder with canonical data.
 */
export function promoteDraftThread(state: AppState, thread: Thread): AppState {
  if (state.threads.some((t) => t.id === thread.id)) return state;
  return { ...state, threads: [...state.threads, thread] };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t;
    const cwdChanged = t.worktreePath !== worktreePath;
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
  return threads === state.threads ? state : { ...state, threads };
}

/**
 * Returns the current persisted project ordering.
 * Projects not in the persisted list are appended at the end.
 */
export function getOrderedProjects(projects: readonly Project[]): Project[] {
  if (persistedProjectOrder.length === 0) return [...projects];
  const cwdIndex = new Map(persistedProjectOrder.map((cwd, i) => [cwd, i]));
  return [...projects].toSorted((a, b) => {
    const ai = cwdIndex.get(a.cwd) ?? persistedProjectOrder.length;
    const bi = cwdIndex.get(b.cwd) ?? persistedProjectOrder.length;
    return ai - bi;
  });
}

export function setProjectOrder(cwds: string[]): void {
  persistedProjectOrder = cwds;
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  promoteDraftThread: (thread: Thread) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  setProjectModel: (projectId: Project["id"], model: string) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
  setSelectedRepoCwd: (projectId: Project["id"], repoCwd: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...readPersistedState(),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  promoteDraftThread: (thread) => set((state) => promoteDraftThread(state, thread)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  setProjectModel: (projectId, model) =>
    set((state) => setProjectModel(state, projectId, model)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
  setSelectedRepoCwd: (projectId, repoCwd) =>
    set((state) => setSelectedRepoCwd(state, projectId, repoCwd)),
}));

// Persist state changes with debouncing to avoid localStorage thrashing
useStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

// Flush pending writes synchronously before page unload to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}

// ── Granular selector hooks ──────────────────────────────────────────
//
// Prefer these over selecting entire `threads`/`projects` arrays.
// They only trigger re-renders when the specific item changes, not
// when unrelated threads or projects are mutated.

/** Select a single thread by ID. Returns `undefined` when not found. */
export function useThread(threadId: ThreadId | null | undefined): Thread | undefined {
  return useStore(
    useCallback(
      (store: AppStore) =>
        threadId ? store.threads.find((t) => t.id === threadId) : undefined,
      [threadId],
    ),
  );
}

/** Check whether a thread exists without subscribing to its contents. */
export function useThreadExists(threadId: ThreadId): boolean {
  return useStore(
    useCallback(
      (store: AppStore) => store.threads.some((t) => t.id === threadId),
      [threadId],
    ),
  );
}

/** Select a single project by ID. Returns `undefined` when not found. */
export function useProject(projectId: ProjectId | null | undefined): Project | undefined {
  return useStore(
    useCallback(
      (store: AppStore) =>
        projectId ? store.projects.find((p) => p.id === projectId) : undefined,
      [projectId],
    ),
  );
}

/** Select the per-project selected repo CWD. */
export function useSelectedRepoCwd(projectId: ProjectId | null | undefined): string | null {
  return useStore(
    useCallback(
      (store: AppStore) =>
        projectId ? (store.selectedRepoCwdByProject[projectId] ?? null) : null,
      [projectId],
    ),
  );
}

/** Batch-select multiple store actions without re-rendering on state changes. */
export function useStoreActions<T>(selector: (store: AppStore) => T): T {
  return useStore(useShallow(selector));
}

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistState(useStore.getState());
  }, []);
  return createElement(Fragment, null, children);
}
