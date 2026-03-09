import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId } from "./baseSchemas";
import { ProviderInteractionMode, ProviderKind, RuntimeMode } from "./orchestration";

export const DRAFT_WS_METHODS = {
  save: "drafts.save",
  list: "drafts.list",
  delete: "drafts.delete",
} as const;

export const DraftRecord = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  prompt: Schema.String,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(Schema.String),
  runtimeMode: Schema.NullOr(RuntimeMode),
  interactionMode: Schema.NullOr(ProviderInteractionMode),
  effort: Schema.NullOr(Schema.String),
  codexFastMode: Schema.NullOr(Schema.Boolean),
  attachmentsJson: Schema.String,
  updatedAt: IsoDateTime,
});
export type DraftRecord = typeof DraftRecord.Type;

export const DraftSaveInput = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  prompt: Schema.String,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(Schema.String),
  runtimeMode: Schema.NullOr(RuntimeMode),
  interactionMode: Schema.NullOr(ProviderInteractionMode),
  effort: Schema.NullOr(Schema.String),
  codexFastMode: Schema.NullOr(Schema.Boolean),
  attachmentsJson: Schema.String,
  updatedAt: IsoDateTime,
});
export type DraftSaveInput = typeof DraftSaveInput.Type;

export const DraftListInput = Schema.Struct({
  projectId: ProjectId,
});
export type DraftListInput = typeof DraftListInput.Type;

export const DraftDeleteInput = Schema.Struct({
  threadId: ThreadId,
});
export type DraftDeleteInput = typeof DraftDeleteInput.Type;

export const DraftListResult = Schema.Struct({
  drafts: Schema.Array(DraftRecord),
});
export type DraftListResult = typeof DraftListResult.Type;
