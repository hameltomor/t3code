import {
  ArrowLeftIcon,
  ChevronRightIcon,
  GitPullRequestIcon,
  GripVerticalIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  ProjectId,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@xbetools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { isMacPlatform, newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { applyProjectOrder, useStore } from "../store";
import { isChatNewLocalShortcut, isChatNewShortcut, shortcutLabelForCommand } from "../keybindings";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { compareThreadsByRecency } from "../lib/threadRecency";
import {
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
} from "./Sidebar.logic";
import { useThreadSelectionStore } from "../threadSelectionStore";
import {
  gitRemoveWorktreeMutationOptions,
  gitRemoveWorkspaceWorktreesMutationOptions,
  gitStatusQueryOptions,
} from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { type DraftThreadEnvMode, useComposerDraftStore } from "../composerDraftStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import { RepoSummaryBadge } from "./RepoSwitcher";
import { useImportWizardStore } from "./ImportWizard/ImportWizardTrigger";
import { ImportWizard } from "./ImportWizard/ImportWizard";
import { FolderPickerModal } from "./FolderPickerModal";
import {
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/context-menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
  getOrphanedWorktreeEntriesForThread,
} from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import { useThreadSearch, getProjectThreadsForSearch } from "../hooks/useThreadSearch";
import { NotificationBell } from "./NotificationCenter";
import { Badge } from "./ui/badge";


const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard API unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: string;
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

function terminalStatusFromRunningIds(
  runningTerminalIds: string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function prStatusIndicator(pr: ThreadPr, forgeProvider: "github" | "gitlab" | "unknown" = "unknown"): PrStatusIndicator | null {
  if (!pr) return null;
  const noun = forgeProvider === "gitlab" ? "MR" : "PR";

  if (pr.state === "open") {
    return {
      label: `${noun} open`,
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} ${noun} open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: `${noun} closed`,
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} ${noun} closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: `${noun} merged`,
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} ${noun} merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function XBEWordmark() {
  return (
    <img
      src="/xbe-wordmark.png"
      alt="XBE"
      className="h-4 shrink-0 dark:brightness-100 brightness-0"
    />
  );
}

/**
 * Derives the server's HTTP origin (scheme + host + port) from the same
 * sources WsTransport uses, converting ws(s) to http(s).
 */
function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
  // Parse to extract just the origin, dropping path/query (e.g. ?token=…)
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

const serverHttpOrigin = getServerHttpOrigin();

/**
 * Deterministic color from a string — picks one of the XBE brand-adjacent
 * hues so fallback avatars have visual variety without random flickering.
 */
const AVATAR_COLORS = [
  "bg-pink-500/15 text-pink-400",
  "bg-violet-500/15 text-violet-400",
  "bg-teal-500/15 text-teal-400",
  "bg-sky-500/15 text-sky-400",
  "bg-amber-500/15 text-amber-400",
] as const;

function avatarColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function ProjectFavicon({ cwd, name }: { cwd: string; name: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`;
  const initial = (name[0] ?? "?").toUpperCase();
  const colorClass = avatarColorForName(name);

  const fallback = (
    <span
      className={`flex size-5 md:size-4 shrink-0 items-center justify-center rounded ${colorClass} text-[10px] md:text-[9px] font-semibold leading-none`}
      aria-hidden
    >
      {initial}
    </span>
  );

  if (status === "error") {
    return fallback;
  }

  return (
    <>
      {status === "loading" && fallback}
      <img
        src={src}
        alt=""
        className={`size-5 md:size-4 shrink-0 rounded object-contain ${status === "loading" ? "hidden" : ""}`}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
      />
    </>
  );
}

function SidebarSettingsRow({
  isOnSettings,
}: {
  isOnSettings: boolean;
}) {
  const router = useRouter();
  const navigate = useNavigate();

  const handleBackClick = useCallback(() => {
    // Use history.back() if there is a previous entry in the session, otherwise go home.
    if (window.history.length > 1) {
      router.history.back();
    } else {
      void navigate({ to: "/" });
    }
  }, [navigate, router.history]);

  const rowClassName = "flex h-10 md:h-8 items-center gap-2 rounded-md px-3 md:px-2 text-sm md:text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  const versionBadge = (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="ml-auto text-[10px] text-muted-foreground-faint">
            v{__APP_VERSION__}
          </span>
        }
      />
      <TooltipPopup side="top">XBE Code v{__APP_VERSION__}</TooltipPopup>
    </Tooltip>
  );

  return (
    <div className="flex flex-col gap-0.5">
      {isOnSettings ? (
        <button type="button" className={rowClassName} onClick={handleBackClick}>
          <ArrowLeftIcon className="size-4 md:size-3.5 shrink-0" />
          <span>Back</span>
          {versionBadge}
        </button>
      ) : (
        <Link to="/settings" className={rowClassName}>
          <SettingsIcon className="size-4 md:size-3.5 shrink-0" />
          <span>Settings</span>
          {versionBadge}
        </Link>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const toggleProject = useStore((store) => store.toggleProject);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearThreadDraft);
  const composerDraftsByThreadId = useComposerDraftStore((store) => store.draftsByThreadId);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const navigate = useNavigate();
  const { settings: appSettings } = useAppSettings();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const isOnSettings = useRouterState({
    select: (state) => state.location.pathname === "/settings",
  });

  // Auto-close mobile sidebar drawer when route changes
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname && isMobile) {
      setOpenMobile(false);
    }
    prevPathnameRef.current = pathname;
  }, [pathname, isMobile, setOpenMobile]);

  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const removeWorkspaceWorktreesMutation = useMutation(
    gitRemoveWorkspaceWorktreesMutationOptions({ queryClient }),
  );
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const importWizardState = useImportWizardStore();
  const selectedThreadIds = useThreadSelectionStore((s) => s.selectedThreadIds);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // ── Drag-and-drop project reordering (desktop only) ──
  const [dragState, setDragState] = useState<{
    dragIndex: number;
    overIndex: number;
    startY: number;
    currentY: number;
  } | null>(null);
  const projectItemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const suppressProjectClickAfterDragRef = useRef(false);

  const { query: searchQuery, setQuery: setSearchQuery, filteredThreadIdSet, isSearching } =
    useThreadSearch(threads, projects);
  const pendingApprovalByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingApprovals(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const pendingUserInputByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingUserInputs(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const projectOrder = useStore((store) => store.projectOrder);
  const reorderProjects = useStore((store) => store.reorderProjects);
  const sortedProjects = useMemo(() => applyProjectOrder(projects, projectOrder), [projects, projectOrder]);
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const { prByThreadId, forgeProviderByThreadId } = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const prMap = new Map<ThreadId, ThreadPr>();
    const fpMap = new Map<ThreadId, "github" | "gitlab" | "unknown">();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      prMap.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
      fpMap.set(target.threadId, status?.forgeProvider ?? "unknown");
    }
    return { prByThreadId: prMap, forgeProviderByThreadId: fpMap };
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      if (storedDraftThread) {
        return (async () => {
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        })();
      }
      clearProjectDraftThreadId(projectId);

      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (activeDraftThread && routeThreadId && activeDraftThread.projectId === projectId) {
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(routeThreadId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve();
      }
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? appSettings.defaultThreadEnvMode,
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [
      appSettings.defaultThreadEnvMode,
      clearProjectDraftThreadId,
      getDraftThreadByProjectId,
      navigate,
      getDraftThread,
      routeThreadId,
      setDraftThreadContext,
      setProjectDraftThreadId,
    ],
  );

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = threads
        .filter((thread) => thread.projectId === projectId)
        .toSorted(compareThreadsByRecency)[0];
      if (!latestThread) return;

      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [navigate, threads],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string): Promise<boolean> => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return false;
      const api = readNativeApi();
      if (!api) return false;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setIsPickingFolder(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return true;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        });
        await handleNewThread(projectId).catch(() => undefined);
      } catch (error) {
        setIsAddingProject(false);
        toastManager.add({
          type: "error",
          title: "Unable to add project",
          description:
            error instanceof Error ? error.message : "An error occurred while adding the project.",
        });
        return false;
      }
      finishAddingProject();
      return true;
    },
    [focusMostRecentThreadForProject, handleNewThread, isAddingProject, projects],
  );

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    }
    setIsPickingFolder(false);
  };

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  /**
   * Delete a single thread: stop session, close terminal, dispatch delete,
   * clean up drafts/state, and optionally remove orphaned worktree.
   */
  const deleteThread = useCallback(
    async (
      threadId: ThreadId,
      opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {},
    ): Promise<void> => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;

      const threadProject = projects.find((project) => project.id === thread.projectId);
      const deletedIds = opts.deletedThreadIds;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? threads.filter((t) => t.id === threadId || !deletedIds.has(t.id))
          : threads;
      const orphanedWorkspaceEntries = getOrphanedWorktreeEntriesForThread(survivingThreads, threadId);
      const orphanedWorktreePath =
        orphanedWorkspaceEntries?.worktreePath ??
        getOrphanedWorktreePathForThread(survivingThreads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({ threadId, deleteHistory: true });
      } catch {
        // Terminal may already be closed
      }

      const allDeletedIds = deletedIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId =
        threads.find((entry) => entry.id !== threadId && !allDeletedIds.has(entry.id))?.id ?? null;
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);
      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        if (orphanedWorkspaceEntries) {
          await removeWorkspaceWorktreesMutation.mutateAsync({
            workspaceWorktreePath: orphanedWorkspaceEntries.worktreePath,
            entries: orphanedWorkspaceEntries.entries.map((entry) => ({
              repoPath: entry.originalPath,
              worktreePath: entry.worktreePath,
            })),
            force: true,
          });
        } else {
          await removeWorktreeMutation.mutateAsync({
            cwd: threadProject.cwd,
            path: orphanedWorktreePath,
            force: true,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      navigate,
      projects,
      removeWorktreeMutation,
      removeWorkspaceWorktreesMutation,
      routeThreadId,
      threads,
    ],
  );

  const handleRenameThread = useCallback(
    (threadId: ThreadId) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      setRenamingThreadId(threadId);
      setRenamingTitle(thread.title);
      renamingCommittedRef.current = false;
    },
    [threads],
  );

  const handleCopyThreadId = useCallback(async (threadId: ThreadId) => {
    try {
      await copyTextToClipboard(threadId);
      toastManager.add({ type: "success", title: "Thread ID copied", description: threadId });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, []);

  const handleCopyWorkspacePath = useCallback(
    async (threadId: ThreadId) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const project = projects.find((p) => p.id === thread.projectId);
      const workspacePath = thread.worktreePath ?? project?.cwd;
      if (!workspacePath) {
        toastManager.add({ type: "warning", title: "No workspace path available" });
        return;
      }
      try {
        await copyTextToClipboard(workspacePath);
        toastManager.add({
          type: "success",
          title: "Workspace path copied",
          description: workspacePath,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to copy workspace path",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [projects, threads],
  );

  const handleDeleteSingleThread = useCallback(
    async (threadId: ThreadId) => {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      if (appSettings.confirmThreadDelete) {
        const api = readNativeApi();
        if (!api) return;
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }
      await deleteThread(threadId);
    },
    [appSettings.confirmThreadDelete, deleteThread, threads],
  );

  const handleMultiMarkUnread = useCallback(() => {
    const ids = [...selectedThreadIds];
    for (const id of ids) {
      markThreadUnread(id);
    }
    clearSelection();
  }, [clearSelection, markThreadUnread, selectedThreadIds]);

  const handleMultiDelete = useCallback(async () => {
    const ids = [...selectedThreadIds];
    if (ids.length === 0) return;
    const count = ids.length;
    if (appSettings.confirmThreadDelete) {
      const api = readNativeApi();
      if (!api) return;
      const confirmed = await api.dialogs.confirm(
        [
          `Delete ${count} thread${count === 1 ? "" : "s"}?`,
          "This permanently clears conversation history for these threads.",
        ].join("\n"),
      );
      if (!confirmed) return;
    }
    const deletedIds = new Set<ThreadId>(ids);
    for (const id of ids) {
      await deleteThread(id, { deletedThreadIds: deletedIds });
    }
    removeFromSelection(ids);
  }, [appSettings.confirmThreadDelete, deleteThread, removeFromSelection, selectedThreadIds]);

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadId);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadId, orderedProjectThreadIds);
        return;
      }

      // Plain click — clear selection, set anchor for future shift-clicks, and navigate
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadId);
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [clearSelection, navigate, rangeSelectTo, selectedThreadIds.size, setSelectionAnchor, toggleThreadSelection],
  );

  const handleImportConversations = useCallback((projectId: ProjectId) => {
    useImportWizardStore.getState().open(projectId);
  }, []);

  const handleDeleteProject = useCallback(
    async (projectId: ProjectId) => {
      const api = readNativeApi();
      if (!api) return;

      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const projectThreads = threads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before deleting it.",
        });
        return;
      }

      const confirmed = await api.dialogs.confirm(
        [`Delete project "${project.name}"?`, "This action cannot be undone."].join("\n"),
      );
      if (!confirmed) return;

      try {
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error deleting project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to delete "${project.name}"`,
          description: message,
        });
      }
    },
    [clearComposerDraftForThread, clearProjectDraftThreadId, getDraftThreadByProjectId, projects, threads],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedThreadIds.size > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const activeThread = routeThreadId
        ? threads.find((thread) => thread.id === routeThreadId)
        : undefined;
      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (isChatNewLocalShortcut(event, keybindings)) {
        const projectId =
          activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
        if (!projectId) return;
        event.preventDefault();
        void handleNewThread(projectId);
        return;
      }

      if (!isChatNewShortcut(event, keybindings)) return;
      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;
      event.preventDefault();
      void handleNewThread(projectId, {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
      });
    };

    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadIds.size === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection, getDraftThread, handleNewThread, keybindings, projects, routeThreadId, selectedThreadIds.size, threads]);

  useEffect(() => {
    const onSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onSearchShortcut);
    return () => {
      window.removeEventListener("keydown", onSearchShortcut);
    };
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "chat.newLocal") ??
      shortcutLabelForCommand(keybindings, "chat.new"),
    [keybindings],
  );

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  // ── Drag-and-drop handlers ──

  const handleDragPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
      if (isMobile) return;
      event.preventDefault();
      event.stopPropagation();
      suppressProjectClickAfterDragRef.current = false;
      setDragState({ dragIndex: index, overIndex: index, startY: event.clientY, currentY: event.clientY });
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    },
    [isMobile],
  );

  const handleDragPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragState) return;
      const dy = event.clientY - dragState.startY;
      // Determine which index we're over based on item rects
      let newOverIndex = dragState.dragIndex;
      const items = sortedProjects.map((p) => projectItemRefs.current.get(p.id));
      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (event.clientY < midY) {
          newOverIndex = i;
          break;
        }
        newOverIndex = i;
      }
      setDragState((prev) => prev ? { ...prev, currentY: event.clientY, overIndex: newOverIndex } : null);
      if (Math.abs(dy) > 4) {
        suppressProjectClickAfterDragRef.current = true;
      }
    },
    [dragState, sortedProjects],
  );

  const handleDragPointerUp = useCallback(
    (_event: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragState) return;
      if (suppressProjectClickAfterDragRef.current) {
        reorderProjects(dragState.dragIndex, dragState.overIndex);
      }
      setDragState(null);
    },
    [dragState, reorderProjects],
  );

  const handleDragPointerCancel = useCallback(() => {
    setDragState(null);
  }, []);

  // Compute drag display order
  const displayProjects = useMemo(() => {
    if (!dragState || dragState.dragIndex === dragState.overIndex) return sortedProjects;
    const ordered = [...sortedProjects];
    const moved = ordered[dragState.dragIndex];
    if (!moved) return sortedProjects;
    ordered.splice(dragState.dragIndex, 1);
    ordered.splice(dragState.overIndex, 0, moved);
    return ordered;
  }, [dragState, sortedProjects]);

  const wordmark = (
    <div className="flex items-center gap-3 md:gap-2">
      <SidebarTrigger className="shrink-0 size-9 md:size-7 md:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 md:gap-1 md:mt-1.5 md:ml-1">
        <a
          href="https://www.x-b-e.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 opacity-80 transition-opacity hover:opacity-100"
        >
          <XBEWordmark />
        </a>
        <span className="truncate text-base md:text-sm font-medium tracking-tight text-muted-foreground">
          Code
        </span>
      </div>
    </div>
  );

  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]">
            {wordmark}
            <div className="ml-auto mt-1.5" />
            {showDesktopUpdateButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`inline-flex size-7 mt-1.5 items-center justify-center rounded-md text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{desktopUpdateTooltip}</TooltipPopup>
              </Tooltip>
            )}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="flex-row items-center gap-3 px-4 py-2 md:gap-2.5 md:px-4 md:py-3">
          {wordmark}
          <div className="ml-auto md:hidden">
            <NotificationBell />
          </div>
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        <div className="px-3 md:px-2 pt-2 pb-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 md:left-2 top-1/2 size-4 md:size-3.5 -translate-y-1/2 text-muted-foreground-secondary" />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search threads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchQuery) {
                    e.preventDefault();
                    setSearchQuery("");
                  } else {
                    searchInputRef.current?.blur();
                  }
                }
              }}
              className="h-12 md:h-7 w-full rounded-md border border-input bg-background pl-8 md:pl-7 pr-8 md:pr-7 text-sm md:text-xs text-foreground placeholder:text-muted-foreground-secondary outline-none ring-ring/24 transition-shadow focus:border-ring focus:ring-[3px] dark:bg-input/32 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground-secondary hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        </div>

        <SidebarGroup className="relative px-3 md:px-2 py-0">
          <SidebarGroupLabel className="h-8 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground-secondary">
            Projects
          </SidebarGroupLabel>
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarGroupAction
                  render={
                    <button
                      type="button"
                      aria-label="Add project"
                    />
                  }
                  className="top-1.5 right-2 size-6 rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    if (isElectron) {
                      void handlePickFolder();
                    } else {
                      setShowFolderPicker(true);
                    }
                  }}
                >
                  <PlusIcon className="size-3.5" />
                </SidebarGroupAction>
              }
            />
            <TooltipPopup side="top">Add project</TooltipPopup>
          </Tooltip>
          <SidebarMenu>
            {displayProjects.map((project, projectIndex) => {
              const searchFilteredThreads = getProjectThreadsForSearch(
                threads,
                project.id,
                filteredThreadIdSet,
              );
              const projectThreads = searchFilteredThreads;
              if (isSearching && projectThreads.length === 0) return null;
              const isThreadListExpanded =
                isSearching || expandedThreadListsByProject.has(project.id);
              const hasHiddenThreads = !isSearching && projectThreads.length > THREAD_PREVIEW_LIMIT;
              const visibleThreads =
                hasHiddenThreads && !isThreadListExpanded
                  ? projectThreads.slice(0, THREAD_PREVIEW_LIMIT)
                  : projectThreads;
                const orderedProjectThreadIds = projectThreads.map((t) => t.id);
              const isDragging = dragState !== null && dragState.dragIndex === sortedProjects.indexOf(project);

              return (
                <Collapsible
                  key={project.id}
                  className="group/collapsible"
                  open={project.expanded}
                  onOpenChange={(open) => {
                    if (open === project.expanded) return;
                    toggleProject(project.id);
                  }}
                >
                  <SidebarMenuItem
                    ref={(el: HTMLLIElement | null) => {
                      if (el) {
                        projectItemRefs.current.set(project.id, el);
                      } else {
                        projectItemRefs.current.delete(project.id);
                      }
                    }}
                    className={isDragging ? "opacity-50" : ""}
                  >
                    <ContextMenu>
                      <ContextMenuTrigger
                        render={<div className="group/project-header relative" />}
                      >
                        {!isMobile && sortedProjects.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Drag to reorder ${project.name}`}
                            className="absolute left-0 top-1/2 z-10 -translate-y-1/2 -translate-x-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground-faint opacity-0 transition-opacity group-hover/project-header:opacity-100 cursor-grab active:cursor-grabbing"
                            onPointerDown={(e) => handleDragPointerDown(e, projectIndex)}
                            onPointerMove={handleDragPointerMove}
                            onPointerUp={handleDragPointerUp}
                            onPointerCancel={handleDragPointerCancel}
                          >
                            <GripVerticalIcon className="size-3" />
                          </button>
                        )}
                        <CollapsibleTrigger
                          render={
                            <SidebarMenuButton
                              size="sm"
                              className="h-12 md:h-7 gap-2.5 md:gap-2 px-3 md:px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground"
                            />
                          }
                        >
                          <ChevronRightIcon
                            className={`-ml-0.5 size-4 md:size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                              project.expanded ? "rotate-90" : ""
                            }`}
                          />
                          <ProjectFavicon cwd={project.cwd} name={project.name} />
                          <span className="flex-1 truncate text-sm md:text-xs font-medium text-foreground/90">
                            {project.name}
                          </span>
                          <RepoSummaryBadge projectId={project.id} workspaceRoot={project.cwd} />
                        </CollapsibleTrigger>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <SidebarMenuAction
                                render={
                                  <button
                                    type="button"
                                    aria-label={`Create new thread in ${project.name}`}
                                  />
                                }
                                showOnHover
                                className="top-1 right-1 size-8 md:size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleNewThread(project.id);
                                }}
                              >
                                <SquarePenIcon className="size-4 md:size-3.5" />
                              </SidebarMenuAction>
                            }
                          />
                          <TooltipPopup side="top">
                            {newThreadShortcutLabel
                              ? `New thread (${newThreadShortcutLabel})`
                              : "New thread"}
                          </TooltipPopup>
                        </Tooltip>
                      </ContextMenuTrigger>
                      <ContextMenuPopup>
                        <ContextMenuItem
                          onClick={() => handleImportConversations(project.id)}
                        >
                          Import Conversations
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => void handleDeleteProject(project.id)}
                        >
                          Delete
                        </ContextMenuItem>
                      </ContextMenuPopup>
                    </ContextMenu>

                    <CollapsibleContent>
                      <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0">
                        {visibleThreads.map((thread) => {
                          const isActive = routeThreadId === thread.id;
                          const isSelected = selectedThreadIds.has(thread.id);
                          const isHighlighted = isActive || isSelected;
                          const latestUserMsg = thread.messages.findLast((m) => m.role === "user");
                          const threadStatus = resolveThreadStatusPill({
                            thread: {
                              ...thread,
                              latestUserMessageAt: latestUserMsg?.createdAt,
                            },
                            hasPendingApprovals: pendingApprovalByThreadId.get(thread.id) === true,
                            hasPendingUserInput: pendingUserInputByThreadId.get(thread.id) === true,
                          });
                          const composerDraft = composerDraftsByThreadId[thread.id];
                          const hasDraftPrompt = composerDraft != null && composerDraft.prompt.length > 0;
                          const prStatus = prStatusIndicator(prByThreadId.get(thread.id) ?? null, forgeProviderByThreadId.get(thread.id));
                          const terminalStatus = terminalStatusFromRunningIds(
                            selectThreadTerminalState(terminalStateByThreadId, thread.id)
                              .runningTerminalIds,
                          );

                          return (
                            <SidebarMenuSubItem key={thread.id} className="w-full" data-thread-item>
                              <ContextMenu>
                                <ContextMenuTrigger
                                  render={
                                    <SidebarMenuSubButton
                                      render={<div role="button" tabIndex={0} />}
                                      size="sm"
                                      isActive={isActive}
                                      className={`h-12 md:h-7 w-full translate-x-0 cursor-pointer select-none justify-start px-3 md:px-2 text-left hover:bg-accent hover:text-foreground ${
                                        isActive
                                          ? "bg-accent/85 text-foreground font-medium ring-1 ring-border/70 dark:bg-accent/55 dark:ring-border/50"
                                          : isSelected
                                            ? "bg-primary/15 text-foreground dark:bg-primary/10"
                                            : "text-muted-foreground"
                                      }`}
                                      onClick={(event) => {
                                        handleThreadClick(event, thread.id, orderedProjectThreadIds);
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        clearSelection();
                                        setSelectionAnchor(thread.id);
                                        if (isMobile) setOpenMobile(false);
                                        void navigate({
                                          to: "/$threadId",
                                          params: { threadId: thread.id },
                                        });
                                      }}
                                    />
                                  }
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                    {prStatus && (
                                      <Tooltip>
                                        <TooltipTrigger
                                          render={
                                            <button
                                              type="button"
                                              aria-label={prStatus.tooltip}
                                              className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                                              onClick={(event) => {
                                                openPrLink(event, prStatus.url);
                                              }}
                                            >
                                              <GitPullRequestIcon className="size-3" />
                                            </button>
                                          }
                                        />
                                        <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
                                      </Tooltip>
                                    )}
                                    {threadStatus && (
                                      <span
                                        className={`inline-flex items-center gap-1 text-[10px] ${threadStatus.colorClass}`}
                                      >
                                        <span
                                          className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                                            threadStatus.pulse ? "animate-pulse" : ""
                                          }`}
                                        />
                                        <span className="hidden md:inline">{threadStatus.label}</span>
                                      </span>
                                    )}
                                    {hasDraftPrompt && !threadStatus && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-orange-500 dark:text-orange-400">
                                        <span className="h-1.5 w-1.5 rounded-full bg-orange-500 dark:bg-orange-400" />
                                        <span className="hidden md:inline">Draft</span>
                                      </span>
                                    )}
                                    {renamingThreadId === thread.id ? (
                                      <input
                                        ref={(el) => {
                                          if (el && renamingInputRef.current !== el) {
                                            renamingInputRef.current = el;
                                            el.focus();
                                            el.select();
                                          }
                                        }}
                                        className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
                                        value={renamingTitle}
                                        onChange={(e) => setRenamingTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          e.stopPropagation();
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            renamingCommittedRef.current = true;
                                            void commitRename(thread.id, renamingTitle, thread.title);
                                          } else if (e.key === "Escape") {
                                            e.preventDefault();
                                            renamingCommittedRef.current = true;
                                            cancelRename();
                                          }
                                        }}
                                        onBlur={() => {
                                          if (!renamingCommittedRef.current) {
                                            void commitRename(thread.id, renamingTitle, thread.title);
                                          }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    ) : (
                                      <span className="min-w-0 flex-1 truncate text-sm md:text-xs">
                                        {thread.title}
                                      </span>
                                    )}
                                  </div>
                                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                    {thread.providerThreadId && (
                                      <Badge variant="outline" size="sm" className="h-4 shrink-0 px-1 text-[10px] leading-none">
                                        {thread.providerThreadId.startsWith("codex:") ? "Codex" : "CC"}
                                      </Badge>
                                    )}
                                    {terminalStatus && (
                                      <span
                                        role="img"
                                        aria-label={terminalStatus.label}
                                        title={terminalStatus.label}
                                        className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                                      >
                                        <TerminalIcon
                                          className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`}
                                        />
                                      </span>
                                    )}
                                    <span
                                      className={`text-xs md:text-[10px] ${
                                        isHighlighted ? "text-foreground/65" : "text-muted-foreground-secondary"
                                      }`}
                                    >
                                      {formatRelativeTime(thread.updatedAt)}
                                    </span>
                                  </div>
                                </ContextMenuTrigger>
                                <ContextMenuPopup>
                                  {isSelected && selectedThreadIds.size > 1 ? (
                                    <>
                                      <ContextMenuItem onClick={handleMultiMarkUnread}>
                                        Mark unread ({selectedThreadIds.size})
                                      </ContextMenuItem>
                                      <ContextMenuSeparator />
                                      <ContextMenuItem
                                        variant="destructive"
                                        onClick={() => void handleMultiDelete()}
                                      >
                                        Delete ({selectedThreadIds.size})
                                      </ContextMenuItem>
                                    </>
                                  ) : (
                                    <>
                                      <ContextMenuItem
                                        onClick={() => handleRenameThread(thread.id)}
                                      >
                                        Rename thread
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() => markThreadUnread(thread.id)}
                                      >
                                        Mark unread
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() => void handleCopyThreadId(thread.id)}
                                      >
                                        Copy Thread ID
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() => void handleCopyWorkspacePath(thread.id)}
                                      >
                                        Copy workspace path
                                      </ContextMenuItem>
                                      <ContextMenuSeparator />
                                      <ContextMenuItem
                                        variant="destructive"
                                        onClick={() => void handleDeleteSingleThread(thread.id)}
                                      >
                                        Delete
                                      </ContextMenuItem>
                                    </>
                                  )}
                                </ContextMenuPopup>
                              </ContextMenu>
                            </SidebarMenuSubItem>
                          );
                        })}

                        {hasHiddenThreads && !isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className="h-12 md:h-6 w-full translate-x-0 justify-start px-3 md:px-2 text-left text-xs md:text-[10px] text-muted-foreground-secondary hover:bg-accent hover:text-muted-foreground/80"
                              onClick={() => {
                                expandThreadListForProject(project.id);
                              }}
                            >
                              <span>Show more</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                        {hasHiddenThreads && isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className="h-12 md:h-6 w-full translate-x-0 justify-start px-3 md:px-2 text-left text-xs md:text-[10px] text-muted-foreground-secondary hover:bg-accent hover:text-muted-foreground/80"
                              onClick={() => {
                                collapseThreadListForProject(project.id);
                              }}
                            >
                              <span>Show less</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>

          {isSearching && threads.length > 0 && filteredThreadIdSet?.size === 0 && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground-secondary">
              No threads matching &ldquo;{searchQuery.trim()}&rdquo;
            </div>
          )}

          {projects.length === 0 && !isSearching && threadsHydrated && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground-secondary">
              No projects yet.
              <br />
              Add one to get started.
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-0 p-2 md:p-2">
        <SidebarSettingsRow isOnSettings={isOnSettings} />
      </SidebarFooter>
      <ImportWizard
        isOpen={importWizardState.isOpen}
        onClose={importWizardState.close}
        projectId={importWizardState.projectId}
      />
      <FolderPickerModal
        isOpen={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={(path) => void addProjectFromPath(path)}
      />
    </>
  );
}
