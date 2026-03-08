import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  ListProjectionNotificationsInput,
  MarkAllReadInput,
  MarkOpenedInput,
  MarkReadInput,
  ProjectionNotification,
  ProjectionNotificationRepository,
  type ProjectionNotificationRepositoryShape,
} from "../Services/ProjectionNotifications.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionNotificationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionNotification,
    execute: (row) =>
      sql`
        INSERT INTO projection_notifications (
          notification_id,
          source_event_id,
          thread_id,
          kind,
          title,
          body,
          read_at,
          opened_at,
          created_at
        )
        VALUES (
          ${row.notificationId},
          ${row.sourceEventId},
          ${row.threadId},
          ${row.kind},
          ${row.title},
          ${row.body},
          ${row.readAt},
          ${row.openedAt},
          ${row.createdAt}
        )
        ON CONFLICT (notification_id)
        DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          read_at = excluded.read_at,
          opened_at = excluded.opened_at
      `,
  });

  const listRecentRows = SqlSchema.findAll({
    Request: ListProjectionNotificationsInput,
    Result: ProjectionNotification,
    execute: ({ limit, offset }) =>
      sql`
        SELECT
          notification_id AS "notificationId",
          source_event_id AS "sourceEventId",
          thread_id AS "threadId",
          kind,
          title,
          body,
          read_at AS "readAt",
          opened_at AS "openedAt",
          created_at AS "createdAt"
        FROM projection_notifications
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
  });

  const countUnreadRow = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: () =>
      sql`
        SELECT COUNT(*) AS count
        FROM projection_notifications
        WHERE read_at IS NULL
      `,
  });

  const markReadRow = SqlSchema.void({
    Request: MarkReadInput,
    execute: ({ notificationId, readAt }) =>
      sql`
        UPDATE projection_notifications
        SET read_at = ${readAt}
        WHERE notification_id = ${notificationId}
          AND read_at IS NULL
      `,
  });

  const markAllReadRow = SqlSchema.void({
    Request: MarkAllReadInput,
    execute: ({ readAt }) =>
      sql`
        UPDATE projection_notifications
        SET read_at = ${readAt}
        WHERE read_at IS NULL
      `,
  });

  const markOpenedRow = SqlSchema.void({
    Request: MarkOpenedInput,
    execute: ({ notificationId, openedAt }) =>
      sql`
        UPDATE projection_notifications
        SET opened_at = ${openedAt}
        WHERE notification_id = ${notificationId}
      `,
  });

  const findBySourceEventIdRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProjectionNotification,
    execute: (sourceEventId) =>
      sql`
        SELECT
          notification_id AS "notificationId",
          source_event_id AS "sourceEventId",
          thread_id AS "threadId",
          kind,
          title,
          body,
          read_at AS "readAt",
          opened_at AS "openedAt",
          created_at AS "createdAt"
        FROM projection_notifications
        WHERE source_event_id = ${sourceEventId}
      `,
  });

  const upsert: ProjectionNotificationRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionNotificationRepository.upsert:query",
          "ProjectionNotificationRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listRecent: ProjectionNotificationRepositoryShape["listRecent"] = (input) =>
    listRecentRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionNotificationRepository.listRecent:query",
          "ProjectionNotificationRepository.listRecent:decodeRows",
        ),
      ),
    );

  const countUnread: ProjectionNotificationRepositoryShape["countUnread"] = () =>
    countUnreadRow(undefined).pipe(
      Effect.map((row) => row.count),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionNotificationRepository.countUnread:query",
          "ProjectionNotificationRepository.countUnread:decodeRow",
        ),
      ),
    );

  const markRead: ProjectionNotificationRepositoryShape["markRead"] = (input) =>
    markReadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionNotificationRepository.markRead:query"),
      ),
    );

  const markAllRead: ProjectionNotificationRepositoryShape["markAllRead"] = (input) =>
    markAllReadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionNotificationRepository.markAllRead:query"),
      ),
    );

  const markOpened: ProjectionNotificationRepositoryShape["markOpened"] = (input) =>
    markOpenedRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionNotificationRepository.markOpened:query"),
      ),
    );

  const getBySourceEventId: ProjectionNotificationRepositoryShape["getBySourceEventId"] = (
    sourceEventId,
  ) =>
    findBySourceEventIdRow(sourceEventId).pipe(
      Effect.map((row) => (Option.isSome(row) ? row.value : null)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionNotificationRepository.getBySourceEventId:query",
          "ProjectionNotificationRepository.getBySourceEventId:decodeRow",
        ),
      ),
    );

  return {
    upsert,
    listRecent,
    countUnread,
    markRead,
    markAllRead,
    markOpened,
    getBySourceEventId,
  } satisfies ProjectionNotificationRepositoryShape;
});

export const ProjectionNotificationRepositoryLive = Layer.effect(
  ProjectionNotificationRepository,
  makeProjectionNotificationRepository,
);
