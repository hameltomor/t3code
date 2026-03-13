import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_context_status (
      thread_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      support TEXT NOT NULL,
      source TEXT NOT NULL,
      freshness TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT,
      token_usage_json TEXT,
      context_window_limit INTEGER,
      percent REAL,
      last_compacted_at TEXT,
      last_compaction_reason TEXT,
      compaction_count INTEGER,
      measured_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
