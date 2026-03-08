import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  ProjectionPushSubscription,
  ProjectionPushSubscriptionRepository,
  type ProjectionPushSubscriptionRepositoryShape,
} from "../Services/ProjectionPushSubscriptions.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionPushSubscriptionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionPushSubscription,
    execute: (row) =>
      sql`
        INSERT INTO projection_push_subscriptions (
          subscription_id,
          endpoint,
          p256dh_key,
          auth_key,
          user_agent,
          created_at,
          last_used_at
        )
        VALUES (
          ${row.subscriptionId},
          ${row.endpoint},
          ${row.p256dhKey},
          ${row.authKey},
          ${row.userAgent},
          ${row.createdAt},
          ${row.lastUsedAt}
        )
        ON CONFLICT (endpoint)
        DO UPDATE SET
          subscription_id = excluded.subscription_id,
          p256dh_key = excluded.p256dh_key,
          auth_key = excluded.auth_key,
          user_agent = excluded.user_agent,
          last_used_at = excluded.last_used_at
      `,
  });

  const listAllRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionPushSubscription,
    execute: () =>
      sql`
        SELECT
          subscription_id AS "subscriptionId",
          endpoint,
          p256dh_key AS "p256dhKey",
          auth_key AS "authKey",
          user_agent AS "userAgent",
          created_at AS "createdAt",
          last_used_at AS "lastUsedAt"
        FROM projection_push_subscriptions
        ORDER BY created_at DESC
      `,
  });

  const deleteByEndpointRow = SqlSchema.void({
    Request: Schema.String,
    execute: (endpoint) =>
      sql`
        DELETE FROM projection_push_subscriptions
        WHERE endpoint = ${endpoint}
      `,
  });

  const updateLastUsedAtRow = SqlSchema.void({
    Request: Schema.Struct({ endpoint: Schema.String, lastUsedAt: Schema.String }),
    execute: ({ endpoint, lastUsedAt }) =>
      sql`
        UPDATE projection_push_subscriptions
        SET last_used_at = ${lastUsedAt}
        WHERE endpoint = ${endpoint}
      `,
  });

  const upsert: ProjectionPushSubscriptionRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionPushSubscriptionRepository.upsert:query",
          "ProjectionPushSubscriptionRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listAll: ProjectionPushSubscriptionRepositoryShape["listAll"] = () =>
    listAllRows(undefined as void).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionPushSubscriptionRepository.listAll:query",
          "ProjectionPushSubscriptionRepository.listAll:decodeRows",
        ),
      ),
    );

  const deleteByEndpoint: ProjectionPushSubscriptionRepositoryShape["deleteByEndpoint"] = (
    endpoint,
  ) =>
    deleteByEndpointRow(endpoint).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPushSubscriptionRepository.deleteByEndpoint:query"),
      ),
    );

  const updateLastUsedAt: ProjectionPushSubscriptionRepositoryShape["updateLastUsedAt"] = (
    endpoint,
    lastUsedAt,
  ) =>
    updateLastUsedAtRow({ endpoint, lastUsedAt }).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPushSubscriptionRepository.updateLastUsedAt:query"),
      ),
    );

  return {
    upsert,
    listAll,
    deleteByEndpoint,
    updateLastUsedAt,
  } satisfies ProjectionPushSubscriptionRepositoryShape;
});

export const ProjectionPushSubscriptionRepositoryLive = Layer.effect(
  ProjectionPushSubscriptionRepository,
  makeProjectionPushSubscriptionRepository,
);
