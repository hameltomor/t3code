import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  DeleteProjectionDraftInput,
  ListProjectionDraftsByProjectInput,
  ProjectionDraft,
  ProjectionDraftRepository,
  type ProjectionDraftRepositoryShape,
} from "../Services/ProjectionDrafts.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionDraftRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionDraft,
    execute: (row) =>
      sql`
        INSERT INTO projection_drafts (
          thread_id,
          project_id,
          prompt,
          provider,
          model,
          runtime_mode,
          interaction_mode,
          effort,
          codex_fast_mode,
          attachments_json,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.projectId},
          ${row.prompt},
          ${row.provider},
          ${row.model},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.effort},
          ${row.codexFastMode},
          ${row.attachmentsJson},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          prompt = excluded.prompt,
          provider = excluded.provider,
          model = excluded.model,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          effort = excluded.effort,
          codex_fast_mode = excluded.codex_fast_mode,
          attachments_json = excluded.attachments_json,
          updated_at = excluded.updated_at
      `,
  });

  const listByProjectRows = SqlSchema.findAll({
    Request: ListProjectionDraftsByProjectInput,
    Result: ProjectionDraft,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          prompt,
          provider,
          model,
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          effort,
          codex_fast_mode AS "codexFastMode",
          attachments_json AS "attachmentsJson",
          updated_at AS "updatedAt"
        FROM projection_drafts
        WHERE project_id = ${projectId}
        ORDER BY updated_at DESC
      `,
  });

  const deleteByThreadRow = SqlSchema.void({
    Request: DeleteProjectionDraftInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_drafts
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionDraftRepositoryShape["upsert"] = (draft) =>
    upsertRow(draft).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionDraftRepository.upsert:query",
          "ProjectionDraftRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listByProjectId: ProjectionDraftRepositoryShape["listByProjectId"] = (input) =>
    listByProjectRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionDraftRepository.listByProjectId:query",
          "ProjectionDraftRepository.listByProjectId:decodeRows",
        ),
      ),
    );

  const deleteByThreadId: ProjectionDraftRepositoryShape["deleteByThreadId"] = (input) =>
    deleteByThreadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionDraftRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listByProjectId,
    deleteByThreadId,
  } satisfies ProjectionDraftRepositoryShape;
});

export const ProjectionDraftRepositoryLive = Layer.effect(
  ProjectionDraftRepository,
  makeProjectionDraftRepository,
);
