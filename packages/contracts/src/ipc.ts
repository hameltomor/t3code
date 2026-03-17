import type {
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitCreateWorkspaceWorktreesInput,
  GitCreateWorkspaceWorktreesResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitRemoveWorkspaceWorktreesInput,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusInput,
  GitStatusResult,
  GitListWorkspaceReposInput,
  GitListWorkspaceReposResult,
} from "./git";
import type {
  DirectoryListInput,
  DirectoryListResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type { ServerConfig } from "./server";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import type { ServerUpsertKeybindingInput, ServerUpsertKeybindingResult } from "./server";
import type {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "./orchestration";
import type {
  AppNotification,
  NotificationListResult,
  NotificationUnreadCountResult,
  VapidPublicKeyResult,
} from "./notification";
import type { DraftListResult, DraftSaveInput } from "./draft";
import { EditorId } from "./editor";
import type {
  HistoryImportListInput,
  HistoryImportConversationSummary,
  HistoryImportPreviewInput,
  HistoryImportConversationPreview,
  HistoryImportExecuteInput,
  HistoryImportExecuteResult,
  HistoryImportValidateLinkInput,
  HistoryImportValidateLinkResult,
  HistoryImportListThreadLinksInput,
  ThreadExternalLink,
} from "./historyImport";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopBridge {
  getWsUrl: () => string | null;
  pickFolder: () => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

export interface NativeApi {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
    listDirectory: (input: DirectoryListInput) => Promise<DirectoryListResult>;
  };
  terminal: {
    open: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
    write: (input: TerminalWriteInput) => Promise<void>;
    resize: (input: TerminalResizeInput) => Promise<void>;
    clear: (input: TerminalClearInput) => Promise<void>;
    restart: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
    close: (input: TerminalCloseInput) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  git: {
    // Existing branch/worktree API
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<void>;
    checkout: (input: GitCheckoutInput) => Promise<void>;
    init: (input: GitInitInput) => Promise<void>;
    // Stacked action API
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    status: (input: GitStatusInput) => Promise<GitStatusResult>;
    runStackedAction: (input: GitRunStackedActionInput) => Promise<GitRunStackedActionResult>;
    listWorkspaceRepos: (
      input: GitListWorkspaceReposInput,
    ) => Promise<GitListWorkspaceReposResult>;
    // Multi-repo workspace worktree API
    createWorkspaceWorktrees: (
      input: GitCreateWorkspaceWorktreesInput,
    ) => Promise<GitCreateWorkspaceWorktreesResult>;
    removeWorkspaceWorktrees: (input: GitRemoveWorkspaceWorktreesInput) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
  };
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    onDomainEvent: (callback: (event: OrchestrationEvent) => void) => () => void;
  };
  notifications: {
    list: (limit?: number, offset?: number) => Promise<NotificationListResult>;
    unreadCount: () => Promise<NotificationUnreadCountResult>;
    markRead: (notificationId: string) => Promise<void>;
    markAllRead: () => Promise<void>;
    markReadByThread: (threadId: string) => Promise<void>;
    markOpened: (notificationId: string) => Promise<void>;
    getVapidPublicKey: () => Promise<VapidPublicKeyResult>;
    subscribePush: (subscription: {
      endpoint: string;
      p256dhKey: string;
      authKey: string;
    }) => Promise<void>;
    unsubscribePush: (endpoint: string) => Promise<void>;
    onNotification: (callback: (notification: AppNotification) => void) => () => void;
  };
  drafts: {
    save: (input: DraftSaveInput) => Promise<void>;
    list: (projectId: string) => Promise<DraftListResult>;
    delete: (threadId: string) => Promise<void>;
  };
  historyImport: {
    list: (input: HistoryImportListInput) => Promise<HistoryImportConversationSummary[]>;
    preview: (input: HistoryImportPreviewInput) => Promise<HistoryImportConversationPreview>;
    execute: (input: HistoryImportExecuteInput) => Promise<HistoryImportExecuteResult>;
    validateLink: (input: HistoryImportValidateLinkInput) => Promise<HistoryImportValidateLinkResult>;
    listThreadLinks: (input: HistoryImportListThreadLinksInput) => Promise<ThreadExternalLink[]>;
  };
}
