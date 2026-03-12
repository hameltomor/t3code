import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  DeleteThreadExternalLinkInput,
  GetThreadExternalLinkInput,
  ThreadExternalLinkEntry,
  ThreadExternalLinkRepository,
  type ThreadExternalLinkRepositoryShape,
} from "../Services/ThreadExternalLinks.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeThreadExternalLinkRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ThreadExternalLinkEntry,
    execute: (row) =>
      sql`
        INSERT INTO thread_external_links (
          thread_id,
          provider_name,
          link_mode,
          provider_conversation_id,
          provider_session_id,
          resume_anchor_id,
          source_path,
          source_fingerprint,
          original_workspace_root,
          original_cwd,
          validation_status,
          raw_resume_seed_json,
          imported_at,
          last_validated_at
        )
        VALUES (
          ${row.threadId},
          ${row.providerName},
          ${row.linkMode},
          ${row.providerConversationId},
          ${row.providerSessionId},
          ${row.resumeAnchorId},
          ${row.sourcePath},
          ${row.sourceFingerprint},
          ${row.originalWorkspaceRoot},
          ${row.originalCwd},
          ${row.validationStatus},
          ${row.rawResumeSeedJson},
          ${row.importedAt},
          ${row.lastValidatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          provider_name = excluded.provider_name,
          link_mode = excluded.link_mode,
          provider_conversation_id = excluded.provider_conversation_id,
          provider_session_id = excluded.provider_session_id,
          resume_anchor_id = excluded.resume_anchor_id,
          source_path = excluded.source_path,
          source_fingerprint = excluded.source_fingerprint,
          original_workspace_root = excluded.original_workspace_root,
          original_cwd = excluded.original_cwd,
          validation_status = excluded.validation_status,
          raw_resume_seed_json = excluded.raw_resume_seed_json,
          imported_at = excluded.imported_at,
          last_validated_at = excluded.last_validated_at
      `,
  });

  const getByThreadRow = SqlSchema.findOneOption({
    Request: GetThreadExternalLinkInput,
    Result: ThreadExternalLinkEntry,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          provider_name AS "providerName",
          link_mode AS "linkMode",
          provider_conversation_id AS "providerConversationId",
          provider_session_id AS "providerSessionId",
          resume_anchor_id AS "resumeAnchorId",
          source_path AS "sourcePath",
          source_fingerprint AS "sourceFingerprint",
          original_workspace_root AS "originalWorkspaceRoot",
          original_cwd AS "originalCwd",
          validation_status AS "validationStatus",
          raw_resume_seed_json AS "rawResumeSeedJson",
          imported_at AS "importedAt",
          last_validated_at AS "lastValidatedAt"
        FROM thread_external_links
        WHERE thread_id = ${threadId}
      `,
  });

  const listByThreadRows = SqlSchema.findAll({
    Request: GetThreadExternalLinkInput,
    Result: ThreadExternalLinkEntry,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          provider_name AS "providerName",
          link_mode AS "linkMode",
          provider_conversation_id AS "providerConversationId",
          provider_session_id AS "providerSessionId",
          resume_anchor_id AS "resumeAnchorId",
          source_path AS "sourcePath",
          source_fingerprint AS "sourceFingerprint",
          original_workspace_root AS "originalWorkspaceRoot",
          original_cwd AS "originalCwd",
          validation_status AS "validationStatus",
          raw_resume_seed_json AS "rawResumeSeedJson",
          imported_at AS "importedAt",
          last_validated_at AS "lastValidatedAt"
        FROM thread_external_links
        WHERE thread_id = ${threadId}
      `,
  });

  const deleteByThreadRow = SqlSchema.void({
    Request: DeleteThreadExternalLinkInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM thread_external_links
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ThreadExternalLinkRepositoryShape["upsert"] = (link) =>
    upsertRow(link).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadExternalLinkRepository.upsert:query",
          "ThreadExternalLinkRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getByThreadId: ThreadExternalLinkRepositoryShape["getByThreadId"] = (input) =>
    getByThreadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadExternalLinkRepository.getByThreadId:query",
          "ThreadExternalLinkRepository.getByThreadId:decodeRows",
        ),
      ),
    );

  const listByThreadId: ThreadExternalLinkRepositoryShape["listByThreadId"] = (input) =>
    listByThreadRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadExternalLinkRepository.listByThreadId:query",
          "ThreadExternalLinkRepository.listByThreadId:decodeRows",
        ),
      ),
    );

  const deleteByThreadId: ThreadExternalLinkRepositoryShape["deleteByThreadId"] = (input) =>
    deleteByThreadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ThreadExternalLinkRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadId,
    listByThreadId,
    deleteByThreadId,
  } satisfies ThreadExternalLinkRepositoryShape;
});

export const ThreadExternalLinkRepositoryLive = Layer.effect(
  ThreadExternalLinkRepository,
  makeThreadExternalLinkRepository,
);
