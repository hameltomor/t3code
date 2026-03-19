import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";

import {
  ProjectionUsageAggregate,
  ProjectionUsageAggregateRepository,
  type ProjectionUsageAggregateRepositoryShape,
  GetUsageByProviderInput,
  GetUsageByDateRangeInput,
  GetTopModelsInput,
  TopModelRow,
  DailyTotalRow,
  ProviderSummaryRow,
} from "../Services/ProjectionUsageAggregate.ts";

const makeProjectionUsageAggregateRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionUsageAggregate,
    execute: (row) =>
      sql`
        INSERT INTO projection_usage_aggregate (
          id, provider, model, date,
          turn_count, input_tokens, output_tokens, total_tokens,
          cached_input_tokens, reasoning_tokens, updated_at
        )
        VALUES (
          ${row.id}, ${row.provider}, ${row.model}, ${row.date},
          ${row.turnCount}, ${row.inputTokens}, ${row.outputTokens}, ${row.totalTokens},
          ${row.cachedInputTokens}, ${row.reasoningTokens}, ${row.updatedAt}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          turn_count = projection_usage_aggregate.turn_count + excluded.turn_count,
          input_tokens = projection_usage_aggregate.input_tokens + excluded.input_tokens,
          output_tokens = projection_usage_aggregate.output_tokens + excluded.output_tokens,
          total_tokens = projection_usage_aggregate.total_tokens + excluded.total_tokens,
          cached_input_tokens = projection_usage_aggregate.cached_input_tokens + excluded.cached_input_tokens,
          reasoning_tokens = projection_usage_aggregate.reasoning_tokens + excluded.reasoning_tokens,
          updated_at = excluded.updated_at
      `,
  });

  const getByProviderRows = SqlSchema.findAll({
    Request: GetUsageByProviderInput,
    Result: ProjectionUsageAggregate,
    execute: ({ provider, dateFrom, dateTo }) =>
      sql`
        SELECT
          id, provider, model, date,
          turn_count AS "turnCount",
          input_tokens AS "inputTokens",
          output_tokens AS "outputTokens",
          total_tokens AS "totalTokens",
          cached_input_tokens AS "cachedInputTokens",
          reasoning_tokens AS "reasoningTokens",
          updated_at AS "updatedAt"
        FROM projection_usage_aggregate
        WHERE provider = ${provider}
          AND date >= ${dateFrom}
          AND date <= ${dateTo}
        ORDER BY date DESC
      `,
  });

  const getAllRows = SqlSchema.findAll({
    Request: GetUsageByDateRangeInput,
    Result: ProjectionUsageAggregate,
    execute: ({ dateFrom, dateTo }) =>
      sql`
        SELECT
          id, provider, model, date,
          turn_count AS "turnCount",
          input_tokens AS "inputTokens",
          output_tokens AS "outputTokens",
          total_tokens AS "totalTokens",
          cached_input_tokens AS "cachedInputTokens",
          reasoning_tokens AS "reasoningTokens",
          updated_at AS "updatedAt"
        FROM projection_usage_aggregate
        WHERE date >= ${dateFrom}
          AND date <= ${dateTo}
        ORDER BY date DESC
      `,
  });

  const getTopModelRows = SqlSchema.findAll({
    Request: GetTopModelsInput,
    Result: TopModelRow,
    execute: ({ dateFrom, dateTo, limit }) =>
      sql`
        SELECT
          provider,
          model,
          SUM(total_tokens) AS "totalTokens",
          SUM(turn_count) AS "turnCount"
        FROM projection_usage_aggregate
        WHERE date >= ${dateFrom}
          AND date <= ${dateTo}
        GROUP BY provider, model
        ORDER BY "totalTokens" DESC
        LIMIT ${limit}
      `,
  });

  const getDailyTotalRows = SqlSchema.findAll({
    Request: GetUsageByDateRangeInput,
    Result: DailyTotalRow,
    execute: ({ dateFrom, dateTo }) =>
      sql`
        SELECT
          date,
          SUM(input_tokens) AS "inputTokens",
          SUM(output_tokens) AS "outputTokens",
          SUM(total_tokens) AS "totalTokens",
          SUM(turn_count) AS "turnCount"
        FROM projection_usage_aggregate
        WHERE date >= ${dateFrom}
          AND date <= ${dateTo}
        GROUP BY date
        ORDER BY date ASC
      `,
  });

  const getProviderSummaryRows = SqlSchema.findAll({
    Request: GetUsageByDateRangeInput,
    Result: ProviderSummaryRow,
    execute: ({ dateFrom, dateTo }) =>
      sql`
        SELECT
          provider,
          SUM(total_tokens) AS "totalTokens",
          SUM(input_tokens) AS "inputTokens",
          SUM(output_tokens) AS "outputTokens",
          SUM(turn_count) AS "turnCount"
        FROM projection_usage_aggregate
        WHERE date >= ${dateFrom}
          AND date <= ${dateTo}
        GROUP BY provider
      `,
  });

  const upsert: ProjectionUsageAggregateRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionUsageAggregateRepository.upsert:query"),
      ),
    );

  const getByProvider: ProjectionUsageAggregateRepositoryShape["getByProvider"] = (input) =>
    getByProviderRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionUsageAggregateRepository.getByProvider:query"),
      ),
    );

  const getAll: ProjectionUsageAggregateRepositoryShape["getAll"] = (input) =>
    getAllRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionUsageAggregateRepository.getAll:query"),
      ),
    );

  const getTopModels: ProjectionUsageAggregateRepositoryShape["getTopModels"] = (input) =>
    getTopModelRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionUsageAggregateRepository.getTopModels:query"),
      ),
    );

  const getDailyTotals: ProjectionUsageAggregateRepositoryShape["getDailyTotals"] = (input) =>
    getDailyTotalRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionUsageAggregateRepository.getDailyTotals:query"),
      ),
    );

  const getProviderSummaries: ProjectionUsageAggregateRepositoryShape["getProviderSummaries"] = (input) =>
    getProviderSummaryRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionUsageAggregateRepository.getProviderSummaries:query"),
      ),
    );

  return {
    upsert,
    getByProvider,
    getAll,
    getTopModels,
    getDailyTotals,
    getProviderSummaries,
  } satisfies ProjectionUsageAggregateRepositoryShape;
});

export const ProjectionUsageAggregateRepositoryLive = Layer.effect(
  ProjectionUsageAggregateRepository,
  makeProjectionUsageAggregateRepository,
);
