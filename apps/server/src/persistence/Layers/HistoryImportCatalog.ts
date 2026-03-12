import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  DeleteHistoryImportCatalogInput,
  HistoryImportCatalogEntry,
  HistoryImportCatalogRepository,
  type HistoryImportCatalogRepositoryShape,
  type ListHistoryImportCatalogInput,
} from "../Services/HistoryImportCatalog.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeHistoryImportCatalogRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: HistoryImportCatalogEntry,
    execute: (row) =>
      sql`
        INSERT INTO history_import_catalog (
          catalog_id,
          provider_name,
          workspace_root,
          cwd,
          title,
          model,
          message_count,
          turn_count,
          provider_conversation_id,
          provider_session_id,
          resume_anchor_id,
          source_kind,
          source_path,
          link_mode,
          validation_status,
          warnings_json,
          fingerprint,
          raw_metadata_json,
          created_at,
          updated_at,
          last_scanned_at
        )
        VALUES (
          ${row.catalogId},
          ${row.providerName},
          ${row.workspaceRoot},
          ${row.cwd},
          ${row.title},
          ${row.model},
          ${row.messageCount},
          ${row.turnCount},
          ${row.providerConversationId},
          ${row.providerSessionId},
          ${row.resumeAnchorId},
          ${row.sourceKind},
          ${row.sourcePath},
          ${row.linkMode},
          ${row.validationStatus},
          ${row.warningsJson},
          ${row.fingerprint},
          ${row.rawMetadataJson},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.lastScannedAt}
        )
        ON CONFLICT (catalog_id)
        DO UPDATE SET
          provider_name = excluded.provider_name,
          workspace_root = excluded.workspace_root,
          cwd = excluded.cwd,
          title = excluded.title,
          model = excluded.model,
          message_count = excluded.message_count,
          turn_count = excluded.turn_count,
          provider_conversation_id = excluded.provider_conversation_id,
          provider_session_id = excluded.provider_session_id,
          resume_anchor_id = excluded.resume_anchor_id,
          source_kind = excluded.source_kind,
          source_path = excluded.source_path,
          link_mode = excluded.link_mode,
          validation_status = excluded.validation_status,
          warnings_json = excluded.warnings_json,
          fingerprint = excluded.fingerprint,
          raw_metadata_json = excluded.raw_metadata_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_scanned_at = excluded.last_scanned_at
      `,
  });

  const listByWorkspaceAll = SqlSchema.findAll({
    Request: Schema.Struct({ workspaceRoot: Schema.String }),
    Result: HistoryImportCatalogEntry,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          catalog_id AS "catalogId",
          provider_name AS "providerName",
          workspace_root AS "workspaceRoot",
          cwd,
          title,
          model,
          message_count AS "messageCount",
          turn_count AS "turnCount",
          provider_conversation_id AS "providerConversationId",
          provider_session_id AS "providerSessionId",
          resume_anchor_id AS "resumeAnchorId",
          source_kind AS "sourceKind",
          source_path AS "sourcePath",
          link_mode AS "linkMode",
          validation_status AS "validationStatus",
          warnings_json AS "warningsJson",
          fingerprint,
          raw_metadata_json AS "rawMetadataJson",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_scanned_at AS "lastScannedAt"
        FROM history_import_catalog
        WHERE workspace_root = ${workspaceRoot}
        ORDER BY last_scanned_at DESC
      `,
  });

  const listByWorkspaceAndProvider = SqlSchema.findAll({
    Request: Schema.Struct({ workspaceRoot: Schema.String, providerName: Schema.String }),
    Result: HistoryImportCatalogEntry,
    execute: ({ workspaceRoot, providerName }) =>
      sql`
        SELECT
          catalog_id AS "catalogId",
          provider_name AS "providerName",
          workspace_root AS "workspaceRoot",
          cwd,
          title,
          model,
          message_count AS "messageCount",
          turn_count AS "turnCount",
          provider_conversation_id AS "providerConversationId",
          provider_session_id AS "providerSessionId",
          resume_anchor_id AS "resumeAnchorId",
          source_kind AS "sourceKind",
          source_path AS "sourcePath",
          link_mode AS "linkMode",
          validation_status AS "validationStatus",
          warnings_json AS "warningsJson",
          fingerprint,
          raw_metadata_json AS "rawMetadataJson",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_scanned_at AS "lastScannedAt"
        FROM history_import_catalog
        WHERE workspace_root = ${workspaceRoot}
          AND provider_name = ${providerName}
        ORDER BY last_scanned_at DESC
      `,
  });

  const deleteByIdRow = SqlSchema.void({
    Request: DeleteHistoryImportCatalogInput,
    execute: ({ catalogId }) =>
      sql`
        DELETE FROM history_import_catalog
        WHERE catalog_id = ${catalogId}
      `,
  });

  const upsert: HistoryImportCatalogRepositoryShape["upsert"] = (entry) =>
    upsertRow(entry).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "HistoryImportCatalogRepository.upsert:query",
          "HistoryImportCatalogRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listByWorkspace: HistoryImportCatalogRepositoryShape["listByWorkspace"] = (
    input: ListHistoryImportCatalogInput,
  ) => {
    const query =
      input.providerName !== undefined
        ? listByWorkspaceAndProvider({
            workspaceRoot: input.workspaceRoot,
            providerName: input.providerName,
          })
        : listByWorkspaceAll({ workspaceRoot: input.workspaceRoot });

    return query.pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "HistoryImportCatalogRepository.listByWorkspace:query",
          "HistoryImportCatalogRepository.listByWorkspace:decodeRows",
        ),
      ),
    );
  };

  const deleteByCatalogId: HistoryImportCatalogRepositoryShape["deleteByCatalogId"] = (input) =>
    deleteByIdRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("HistoryImportCatalogRepository.deleteByCatalogId:query"),
      ),
    );

  return {
    upsert,
    listByWorkspace,
    deleteByCatalogId,
  } satisfies HistoryImportCatalogRepositoryShape;
});

export const HistoryImportCatalogRepositoryLive = Layer.effect(
  HistoryImportCatalogRepository,
  makeHistoryImportCatalogRepository,
);
