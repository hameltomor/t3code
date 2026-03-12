import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderInteractionMode, RuntimeMode } from "./orchestration";

// ── WS Method Constants ──────────────────────────────────────────────

export const HISTORY_IMPORT_WS_METHODS = {
  list: "historyImport.list",
  preview: "historyImport.preview",
  execute: "historyImport.execute",
  validateLink: "historyImport.validateLink",
  listThreadLinks: "historyImport.listThreadLinks",
} as const;

// ── Push Channel Constants ───────────────────────────────────────────

export const HISTORY_IMPORT_WS_CHANNELS = {
  catalogUpdated: "historyImport.catalogUpdated",
} as const;

// ── Enums ────────────────────────────────────────────────────────────

export const HistoryImportProvider = Schema.Literals(["codex", "claudeCode"]);
export type HistoryImportProvider = typeof HistoryImportProvider.Type;

export const HistoryImportLinkMode = Schema.Literals([
  "native-resume",
  "transcript-replay",
  "snapshot-only",
]);
export type HistoryImportLinkMode = typeof HistoryImportLinkMode.Type;

export const HistoryImportValidationStatus = Schema.Literals([
  "unknown",
  "valid",
  "missing",
  "stale",
  "invalid",
  "importing",
]);
export type HistoryImportValidationStatus = typeof HistoryImportValidationStatus.Type;

// ── Record Schemas ───────────────────────────────────────────────────

export const HistoryImportConversationSummary = Schema.Struct({
  catalogId: TrimmedNonEmptyString,
  providerName: HistoryImportProvider,
  workspaceRoot: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  model: Schema.NullOr(TrimmedNonEmptyString),
  messageCount: NonNegativeInt,
  turnCount: NonNegativeInt,
  providerConversationId: Schema.NullOr(TrimmedNonEmptyString),
  providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
  resumeAnchorId: Schema.NullOr(TrimmedNonEmptyString),
  sourceKind: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
  linkMode: HistoryImportLinkMode,
  validationStatus: HistoryImportValidationStatus,
  warningsJson: Schema.String,
  fingerprint: TrimmedNonEmptyString,
  rawMetadataJson: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastScannedAt: IsoDateTime,
});
export type HistoryImportConversationSummary = typeof HistoryImportConversationSummary.Type;

export const HistoryImportConversationPreview = Schema.Struct({
  catalogId: TrimmedNonEmptyString,
  providerName: HistoryImportProvider,
  title: TrimmedNonEmptyString,
  messages: Schema.Array(
    Schema.Struct({ role: Schema.String, text: Schema.String, createdAt: IsoDateTime }),
  ),
  activities: Schema.Array(
    Schema.Struct({ kind: TrimmedNonEmptyString, summary: TrimmedNonEmptyString }),
  ),
  totalMessageCount: NonNegativeInt,
  totalActivityCount: NonNegativeInt,
  isTruncated: Schema.Boolean,
  linkMode: HistoryImportLinkMode,
  warnings: Schema.Array(Schema.String),
});
export type HistoryImportConversationPreview = typeof HistoryImportConversationPreview.Type;

export const HistoryImportExecuteInput = Schema.Struct({
  catalogId: TrimmedNonEmptyString,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  linkMode: HistoryImportLinkMode,
});
export type HistoryImportExecuteInput = typeof HistoryImportExecuteInput.Type;

export const HistoryImportExecuteResult = Schema.Struct({
  threadId: ThreadId,
  messageCount: NonNegativeInt,
  activityCount: NonNegativeInt,
  linkMode: HistoryImportLinkMode,
  importedAt: IsoDateTime,
});
export type HistoryImportExecuteResult = typeof HistoryImportExecuteResult.Type;

export const ThreadExternalLink = Schema.Struct({
  threadId: ThreadId,
  providerName: HistoryImportProvider,
  linkMode: HistoryImportLinkMode,
  providerConversationId: Schema.NullOr(TrimmedNonEmptyString),
  providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
  resumeAnchorId: Schema.NullOr(TrimmedNonEmptyString),
  sourcePath: TrimmedNonEmptyString,
  sourceFingerprint: TrimmedNonEmptyString,
  originalWorkspaceRoot: TrimmedNonEmptyString,
  originalCwd: TrimmedNonEmptyString,
  validationStatus: HistoryImportValidationStatus,
  rawResumeSeedJson: Schema.NullOr(Schema.String),
  importedAt: IsoDateTime,
  lastValidatedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadExternalLink = typeof ThreadExternalLink.Type;

// ── Input Schemas for WS Methods ─────────────────────────────────────

export const HistoryImportListInput = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
  providerFilter: Schema.optional(HistoryImportProvider),
});
export type HistoryImportListInput = typeof HistoryImportListInput.Type;

export const HistoryImportPreviewInput = Schema.Struct({
  catalogId: TrimmedNonEmptyString,
  maxMessages: Schema.optional(NonNegativeInt),
});
export type HistoryImportPreviewInput = typeof HistoryImportPreviewInput.Type;

export const HistoryImportValidateLinkInput = Schema.Struct({
  threadId: ThreadId,
});
export type HistoryImportValidateLinkInput = typeof HistoryImportValidateLinkInput.Type;

export const HistoryImportListThreadLinksInput = Schema.Struct({
  threadId: ThreadId,
});
export type HistoryImportListThreadLinksInput = typeof HistoryImportListThreadLinksInput.Type;

export const HistoryImportValidateLinkResult = Schema.Struct({
  threadId: ThreadId,
  validationStatus: HistoryImportValidationStatus,
  lastValidatedAt: IsoDateTime,
});
export type HistoryImportValidateLinkResult = typeof HistoryImportValidateLinkResult.Type;
