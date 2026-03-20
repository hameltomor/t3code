import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_usage_aggregate
  `;

  yield* sql`
    DELETE FROM projection_state
    WHERE projector = 'projection.usage-aggregate'
  `;
});
