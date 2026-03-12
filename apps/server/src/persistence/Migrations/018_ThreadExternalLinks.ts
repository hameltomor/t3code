import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_external_links (
      thread_id                 TEXT PRIMARY KEY,
      provider_name             TEXT NOT NULL,
      link_mode                 TEXT NOT NULL,
      provider_conversation_id  TEXT,
      provider_session_id       TEXT,
      resume_anchor_id          TEXT,
      source_path               TEXT NOT NULL,
      source_fingerprint        TEXT NOT NULL,
      original_workspace_root   TEXT NOT NULL,
      original_cwd              TEXT NOT NULL,
      validation_status         TEXT NOT NULL DEFAULT 'unknown',
      raw_resume_seed_json      TEXT,
      imported_at               TEXT NOT NULL,
      last_validated_at         TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_external_links_provider
    ON thread_external_links(provider_name, provider_conversation_id)
  `;
});
