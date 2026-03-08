import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_notifications (
      notification_id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE,
      thread_id       TEXT NOT NULL,
      kind            TEXT NOT NULL,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      read_at         TEXT,
      opened_at       TEXT,
      created_at      TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_notif_thread
    ON projection_notifications(thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_notif_created
    ON projection_notifications(created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_notif_unread
    ON projection_notifications(read_at)
    WHERE read_at IS NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_push_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      endpoint        TEXT NOT NULL UNIQUE,
      p256dh_key      TEXT NOT NULL,
      auth_key        TEXT NOT NULL,
      user_agent      TEXT,
      created_at      TEXT NOT NULL,
      last_used_at    TEXT
    )
  `;
});
