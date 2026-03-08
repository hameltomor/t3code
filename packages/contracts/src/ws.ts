import { Schema, Struct } from "effect";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

import {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  ORCHESTRATION_WS_METHODS,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsInput,
} from "./orchestration";
import {
  NOTIFICATION_WS_METHODS,
  NotificationListInput,
  NotificationMarkOpenedInput,
  NotificationMarkReadByThreadInput,
  NotificationMarkReadInput,
  PushSubscriptionInput,
  PushUnsubscribeInput,
} from "./notification";
import {
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitInitInput,
  GitListBranchesInput,
  GitPullInput,
  GitRemoveWorktreeInput,
  GitRunStackedActionInput,
  GitStatusInput,
  GitListWorkspaceReposInput,
  GitCreateWorkspaceWorktreesInput,
  GitRemoveWorkspaceWorktreesInput,
} from "./git";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalWriteInput,
} from "./terminal";
import { KeybindingRule } from "./keybindings";
import { ProjectSearchEntriesInput, ProjectWriteFileInput } from "./project";
import { OpenInEditorInput } from "./editor";

// ── WebSocket RPC Method Names ───────────────────────────────────────

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitStatus: "git.status",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitListWorkspaceRepos: "git.listWorkspaceRepos",
  gitCreateWorkspaceWorktrees: "git.createWorkspaceWorktrees",
  gitRemoveWorkspaceWorktrees: "git.removeWorkspaceWorktrees",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverUpsertKeybinding: "server.upsertKeybinding",

  // Notification methods
  notificationList: NOTIFICATION_WS_METHODS.list,
  notificationUnreadCount: NOTIFICATION_WS_METHODS.unreadCount,
  notificationMarkRead: NOTIFICATION_WS_METHODS.markRead,
  notificationMarkAllRead: NOTIFICATION_WS_METHODS.markAllRead,
  notificationMarkReadByThread: NOTIFICATION_WS_METHODS.markReadByThread,
  notificationMarkOpened: NOTIFICATION_WS_METHODS.markOpened,
  notificationGetVapidPublicKey: NOTIFICATION_WS_METHODS.getVapidPublicKey,
  notificationSubscribePush: NOTIFICATION_WS_METHODS.subscribePush,
  notificationUnsubscribePush: NOTIFICATION_WS_METHODS.unsubscribePush,
} as const;

// ── Push Event Channels ──────────────────────────────────────────────

export const WS_CHANNELS = {
  terminalEvent: "terminal.event",
  serverWelcome: "server.welcome",
  serverConfigUpdated: "server.configUpdated",
  notificationCreated: "notification.created",
} as const;

// -- Tagged Union of all request body schemas ─────────────────────────

const tagRequestBody = <const Tag extends string, const Fields extends Schema.Struct.Fields>(
  tag: Tag,
  schema: Schema.Struct<Fields>,
) =>
  schema.mapFields(
    Struct.assign({ _tag: Schema.tag(tag) }),
    // PreserveChecks is safe here. No existing schema should have checks depending on the tag
    { unsafePreserveChecks: true },
  );

const WebSocketRequestBody = Schema.Union([
  // Orchestration methods
  tagRequestBody(
    ORCHESTRATION_WS_METHODS.dispatchCommand,
    Schema.Struct({ command: ClientOrchestrationCommand }),
  ),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getSnapshot, OrchestrationGetSnapshotInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getTurnDiff, OrchestrationGetTurnDiffInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getFullThreadDiff, OrchestrationGetFullThreadDiffInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.replayEvents, OrchestrationReplayEventsInput),

  // Project Search
  tagRequestBody(WS_METHODS.projectsSearchEntries, ProjectSearchEntriesInput),
  tagRequestBody(WS_METHODS.projectsWriteFile, ProjectWriteFileInput),

  // Shell methods
  tagRequestBody(WS_METHODS.shellOpenInEditor, OpenInEditorInput),

  // Git methods
  tagRequestBody(WS_METHODS.gitPull, GitPullInput),
  tagRequestBody(WS_METHODS.gitStatus, GitStatusInput),
  tagRequestBody(WS_METHODS.gitRunStackedAction, GitRunStackedActionInput),
  tagRequestBody(WS_METHODS.gitListBranches, GitListBranchesInput),
  tagRequestBody(WS_METHODS.gitCreateWorktree, GitCreateWorktreeInput),
  tagRequestBody(WS_METHODS.gitRemoveWorktree, GitRemoveWorktreeInput),
  tagRequestBody(WS_METHODS.gitCreateBranch, GitCreateBranchInput),
  tagRequestBody(WS_METHODS.gitCheckout, GitCheckoutInput),
  tagRequestBody(WS_METHODS.gitInit, GitInitInput),
  tagRequestBody(WS_METHODS.gitListWorkspaceRepos, GitListWorkspaceReposInput),
  tagRequestBody(WS_METHODS.gitCreateWorkspaceWorktrees, GitCreateWorkspaceWorktreesInput),
  tagRequestBody(WS_METHODS.gitRemoveWorkspaceWorktrees, GitRemoveWorkspaceWorktreesInput),

  // Terminal methods
  tagRequestBody(WS_METHODS.terminalOpen, TerminalOpenInput),
  tagRequestBody(WS_METHODS.terminalWrite, TerminalWriteInput),
  tagRequestBody(WS_METHODS.terminalResize, TerminalResizeInput),
  tagRequestBody(WS_METHODS.terminalClear, TerminalClearInput),
  tagRequestBody(WS_METHODS.terminalRestart, TerminalRestartInput),
  tagRequestBody(WS_METHODS.terminalClose, TerminalCloseInput),

  // Server meta
  tagRequestBody(WS_METHODS.serverGetConfig, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverUpsertKeybinding, KeybindingRule),

  // Notification methods
  tagRequestBody(WS_METHODS.notificationList, NotificationListInput),
  tagRequestBody(WS_METHODS.notificationUnreadCount, Schema.Struct({})),
  tagRequestBody(WS_METHODS.notificationMarkRead, NotificationMarkReadInput),
  tagRequestBody(WS_METHODS.notificationMarkAllRead, Schema.Struct({})),
  tagRequestBody(WS_METHODS.notificationMarkReadByThread, NotificationMarkReadByThreadInput),
  tagRequestBody(WS_METHODS.notificationMarkOpened, NotificationMarkOpenedInput),
  tagRequestBody(WS_METHODS.notificationGetVapidPublicKey, Schema.Struct({})),
  tagRequestBody(WS_METHODS.notificationSubscribePush, PushSubscriptionInput),
  tagRequestBody(WS_METHODS.notificationUnsubscribePush, PushUnsubscribeInput),
]);

export const WebSocketRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  body: WebSocketRequestBody,
});
export type WebSocketRequest = typeof WebSocketRequest.Type;

export const WebSocketResponse = Schema.Struct({
  id: TrimmedNonEmptyString,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      message: Schema.String,
    }),
  ),
});
export type WebSocketResponse = typeof WebSocketResponse.Type;

export const WsPush = Schema.Struct({
  type: Schema.Literal("push"),
  channel: TrimmedNonEmptyString,
  data: Schema.Unknown,
});
export type WsPush = typeof WsPush.Type;

// ── Union of all server → client messages ─────────────────────────────

export const WsResponse = Schema.Union([WebSocketResponse, WsPush]);
export type WsResponse = typeof WsResponse.Type;

// ── Server welcome payload ───────────────────────────────────────────

export const WsWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type WsWelcomePayload = typeof WsWelcomePayload.Type;
