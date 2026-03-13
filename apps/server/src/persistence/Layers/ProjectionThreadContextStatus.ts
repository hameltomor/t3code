import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";

import {
  ProjectionThreadContextStatus,
  ProjectionThreadContextStatusRepository,
  type ProjectionThreadContextStatusRepositoryShape,
  DeleteProjectionThreadContextStatusInput,
  GetProjectionThreadContextStatusInput,
} from "../Services/ProjectionThreadContextStatus.ts";

const makeProjectionThreadContextStatusRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadContextStatusRow = SqlSchema.void({
    Request: ProjectionThreadContextStatus,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_context_status (
          thread_id,
          provider,
          support,
          source,
          freshness,
          status,
          model,
          token_usage_json,
          context_window_limit,
          percent,
          last_compacted_at,
          last_compaction_reason,
          compaction_count,
          measured_at,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.provider},
          ${row.support},
          ${row.source},
          ${row.freshness},
          ${row.status},
          ${row.model},
          ${row.tokenUsageJson},
          ${row.contextWindowLimit},
          ${row.percent},
          ${row.lastCompactedAt},
          ${row.lastCompactionReason},
          ${row.compactionCount},
          ${row.measuredAt},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          provider = excluded.provider,
          support = excluded.support,
          source = excluded.source,
          freshness = excluded.freshness,
          status = excluded.status,
          model = excluded.model,
          token_usage_json = excluded.token_usage_json,
          context_window_limit = excluded.context_window_limit,
          percent = excluded.percent,
          last_compacted_at = excluded.last_compacted_at,
          last_compaction_reason = excluded.last_compaction_reason,
          compaction_count = excluded.compaction_count,
          measured_at = excluded.measured_at,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionThreadContextStatusRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadContextStatusInput,
    Result: ProjectionThreadContextStatus,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          provider,
          support,
          source,
          freshness,
          status,
          model,
          token_usage_json AS "tokenUsageJson",
          context_window_limit AS "contextWindowLimit",
          percent,
          last_compacted_at AS "lastCompactedAt",
          last_compaction_reason AS "lastCompactionReason",
          compaction_count AS "compactionCount",
          measured_at AS "measuredAt",
          updated_at AS "updatedAt"
        FROM projection_thread_context_status
        WHERE thread_id = ${threadId}
      `,
  });

  const deleteProjectionThreadContextStatusRow = SqlSchema.void({
    Request: DeleteProjectionThreadContextStatusInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_context_status
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadContextStatusRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadContextStatusRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadContextStatusRepository.upsert:query"),
      ),
    );

  const getByThreadId: ProjectionThreadContextStatusRepositoryShape["getByThreadId"] = (input) =>
    getProjectionThreadContextStatusRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadContextStatusRepository.getByThreadId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadContextStatusRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteProjectionThreadContextStatusRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadContextStatusRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadContextStatusRepositoryShape;
});

export const ProjectionThreadContextStatusRepositoryLive = Layer.effect(
  ProjectionThreadContextStatusRepository,
  makeProjectionThreadContextStatusRepository,
);
