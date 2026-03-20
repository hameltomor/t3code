import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_usage_aggregate (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      date TEXT NOT NULL,
      turn_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_usage_aggregate_provider
    ON projection_usage_aggregate(provider)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_usage_aggregate_date
    ON projection_usage_aggregate(date)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_usage_aggregate_provider_date
    ON projection_usage_aggregate(provider, date)
  `;
});
