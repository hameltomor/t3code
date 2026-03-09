import { IsoDateTime, ProjectId, ThreadId } from "@xbetools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionDraft = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  prompt: Schema.String,
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  runtimeMode: Schema.NullOr(Schema.String),
  interactionMode: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  codexFastMode: Schema.NullOr(Schema.Boolean),
  attachmentsJson: Schema.String,
  updatedAt: IsoDateTime,
});
export type ProjectionDraft = typeof ProjectionDraft.Type;

export const ListProjectionDraftsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionDraftsByProjectInput = typeof ListProjectionDraftsByProjectInput.Type;

export const DeleteProjectionDraftInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionDraftInput = typeof DeleteProjectionDraftInput.Type;

export interface ProjectionDraftRepositoryShape {
  readonly upsert: (draft: ProjectionDraft) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listByProjectId: (
    input: ListProjectionDraftsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionDraft>, ProjectionRepositoryError>;

  readonly deleteByThreadId: (
    input: DeleteProjectionDraftInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionDraftRepository extends ServiceMap.Service<
  ProjectionDraftRepository,
  ProjectionDraftRepositoryShape
>()("xbe/persistence/Services/ProjectionDrafts/ProjectionDraftRepository") {}
