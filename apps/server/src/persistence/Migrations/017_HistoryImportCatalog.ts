import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS history_import_catalog (
      catalog_id                TEXT PRIMARY KEY,
      provider_name             TEXT NOT NULL,
      workspace_root            TEXT NOT NULL,
      cwd                       TEXT NOT NULL,
      title                     TEXT NOT NULL,
      model                     TEXT,
      message_count             INTEGER NOT NULL DEFAULT 0,
      turn_count                INTEGER NOT NULL DEFAULT 0,
      provider_conversation_id  TEXT,
      provider_session_id       TEXT,
      resume_anchor_id          TEXT,
      source_kind               TEXT NOT NULL,
      source_path               TEXT NOT NULL,
      link_mode                 TEXT NOT NULL DEFAULT 'snapshot-only',
      validation_status         TEXT NOT NULL DEFAULT 'unknown',
      warnings_json             TEXT NOT NULL DEFAULT '[]',
      fingerprint               TEXT NOT NULL,
      raw_metadata_json         TEXT NOT NULL DEFAULT '{}',
      created_at                TEXT NOT NULL,
      updated_at                TEXT NOT NULL,
      last_scanned_at           TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_history_import_catalog_workspace
    ON history_import_catalog(workspace_root, provider_name)
  `;
});
