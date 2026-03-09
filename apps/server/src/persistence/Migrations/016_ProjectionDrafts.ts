import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_drafts (
      thread_id        TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL,
      prompt           TEXT NOT NULL DEFAULT '',
      provider         TEXT,
      model            TEXT,
      runtime_mode     TEXT,
      interaction_mode TEXT,
      effort           TEXT,
      codex_fast_mode  INTEGER,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      updated_at       TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_drafts_project
    ON projection_drafts(project_id)
  `;
});
