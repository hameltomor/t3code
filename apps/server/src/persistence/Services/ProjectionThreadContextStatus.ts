/**
 * ProjectionThreadContextStatusRepository - Repository interface for thread context status.
 *
 * Owns persistence operations for projected context window utilization status
 * for each thread.
 *
 * @module ProjectionThreadContextStatusRepository
 */
import { IsoDateTime, ThreadId } from "@xbetools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadContextStatus = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.String,
  support: Schema.String,
  source: Schema.String,
  freshness: Schema.String,
  status: Schema.String,
  model: Schema.NullOr(Schema.String),
  tokenUsageJson: Schema.NullOr(Schema.String),
  contextWindowLimit: Schema.NullOr(Schema.Number),
  percent: Schema.NullOr(Schema.Number),
  lastCompactedAt: Schema.NullOr(Schema.String),
  lastCompactionReason: Schema.NullOr(Schema.String),
  compactionCount: Schema.NullOr(Schema.Number),
  measuredAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadContextStatus = typeof ProjectionThreadContextStatus.Type;

export const GetProjectionThreadContextStatusInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionThreadContextStatusInput =
  typeof GetProjectionThreadContextStatusInput.Type;

export const DeleteProjectionThreadContextStatusInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadContextStatusInput =
  typeof DeleteProjectionThreadContextStatusInput.Type;

/**
 * ProjectionThreadContextStatusRepositoryShape - Service API for projected thread context status.
 */
export interface ProjectionThreadContextStatusRepositoryShape {
  /**
   * Insert or replace a projected thread-context-status row.
   *
   * Upserts by `threadId`.
   */
  readonly upsert: (
    row: ProjectionThreadContextStatus,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read projected thread-context-status state by thread id.
   */
  readonly getByThreadId: (
    input: GetProjectionThreadContextStatusInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadContextStatus>, ProjectionRepositoryError>;

  /**
   * Delete projected thread-context-status state by thread id.
   */
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadContextStatusInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionThreadContextStatusRepository - Service tag for thread-context-status persistence.
 */
export class ProjectionThreadContextStatusRepository extends ServiceMap.Service<
  ProjectionThreadContextStatusRepository,
  ProjectionThreadContextStatusRepositoryShape
>()("xbe/persistence/Services/ProjectionThreadContextStatus/ProjectionThreadContextStatusRepository") {}
