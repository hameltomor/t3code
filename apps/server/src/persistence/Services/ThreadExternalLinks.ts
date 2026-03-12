import { IsoDateTime } from "@xbetools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ThreadExternalLinkEntry = Schema.Struct({
  threadId: Schema.String,
  providerName: Schema.String,
  linkMode: Schema.String,
  providerConversationId: Schema.NullOr(Schema.String),
  providerSessionId: Schema.NullOr(Schema.String),
  resumeAnchorId: Schema.NullOr(Schema.String),
  sourcePath: Schema.String,
  sourceFingerprint: Schema.String,
  originalWorkspaceRoot: Schema.String,
  originalCwd: Schema.String,
  validationStatus: Schema.String,
  rawResumeSeedJson: Schema.NullOr(Schema.String),
  importedAt: IsoDateTime,
  lastValidatedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadExternalLinkEntry = typeof ThreadExternalLinkEntry.Type;

export const GetThreadExternalLinkInput = Schema.Struct({
  threadId: Schema.String,
});
export type GetThreadExternalLinkInput = typeof GetThreadExternalLinkInput.Type;

export const DeleteThreadExternalLinkInput = Schema.Struct({
  threadId: Schema.String,
});
export type DeleteThreadExternalLinkInput = typeof DeleteThreadExternalLinkInput.Type;

export interface ThreadExternalLinkRepositoryShape {
  readonly upsert: (
    link: ThreadExternalLinkEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getByThreadId: (
    input: GetThreadExternalLinkInput,
  ) => Effect.Effect<Option.Option<ThreadExternalLinkEntry>, ProjectionRepositoryError>;

  readonly listByThreadId: (
    input: GetThreadExternalLinkInput,
  ) => Effect.Effect<ReadonlyArray<ThreadExternalLinkEntry>, ProjectionRepositoryError>;

  readonly deleteByThreadId: (
    input: DeleteThreadExternalLinkInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ThreadExternalLinkRepository extends ServiceMap.Service<
  ThreadExternalLinkRepository,
  ThreadExternalLinkRepositoryShape
>()("xbe/persistence/Services/ThreadExternalLinks/ThreadExternalLinkRepository") {}
