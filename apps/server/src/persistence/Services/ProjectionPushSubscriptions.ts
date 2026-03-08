import { IsoDateTime } from "@xbetools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionPushSubscription = Schema.Struct({
  subscriptionId: Schema.String,
  endpoint: Schema.String,
  p256dhKey: Schema.String,
  authKey: Schema.String,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  lastUsedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionPushSubscription = typeof ProjectionPushSubscription.Type;

export interface ProjectionPushSubscriptionRepositoryShape {
  readonly upsert: (
    row: ProjectionPushSubscription,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionPushSubscription>,
    ProjectionRepositoryError
  >;

  readonly deleteByEndpoint: (
    endpoint: string,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly updateLastUsedAt: (
    endpoint: string,
    lastUsedAt: string,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionPushSubscriptionRepository extends ServiceMap.Service<
  ProjectionPushSubscriptionRepository,
  ProjectionPushSubscriptionRepositoryShape
>()(
  "xbe/persistence/Services/ProjectionPushSubscriptions/ProjectionPushSubscriptionRepository",
) {}
