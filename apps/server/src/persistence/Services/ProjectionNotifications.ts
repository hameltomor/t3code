import { IsoDateTime, ThreadId } from "@xbetools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionNotification = Schema.Struct({
  notificationId: Schema.String,
  sourceEventId: Schema.String,
  threadId: ThreadId,
  kind: Schema.String,
  title: Schema.String,
  body: Schema.String,
  readAt: Schema.NullOr(IsoDateTime),
  openedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
});
export type ProjectionNotification = typeof ProjectionNotification.Type;

export const ListProjectionNotificationsInput = Schema.Struct({
  limit: Schema.Number,
  offset: Schema.Number,
});
export type ListProjectionNotificationsInput = typeof ListProjectionNotificationsInput.Type;

export const MarkReadInput = Schema.Struct({
  notificationId: Schema.String,
  readAt: IsoDateTime,
});
export type MarkReadInput = typeof MarkReadInput.Type;

export const MarkOpenedInput = Schema.Struct({
  notificationId: Schema.String,
  openedAt: IsoDateTime,
});
export type MarkOpenedInput = typeof MarkOpenedInput.Type;

export const MarkAllReadInput = Schema.Struct({
  readAt: IsoDateTime,
});
export type MarkAllReadInput = typeof MarkAllReadInput.Type;

export interface ProjectionNotificationRepositoryShape {
  readonly upsert: (
    row: ProjectionNotification,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listRecent: (
    input: ListProjectionNotificationsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionNotification>, ProjectionRepositoryError>;

  readonly countUnread: () => Effect.Effect<number, ProjectionRepositoryError>;

  readonly markRead: (
    input: MarkReadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly markAllRead: (
    input: MarkAllReadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly markOpened: (
    input: MarkOpenedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getBySourceEventId: (
    sourceEventId: string,
  ) => Effect.Effect<ProjectionNotification | null, ProjectionRepositoryError>;
}

export class ProjectionNotificationRepository extends ServiceMap.Service<
  ProjectionNotificationRepository,
  ProjectionNotificationRepositoryShape
>()("xbe/persistence/Services/ProjectionNotifications/ProjectionNotificationRepository") {}
