/**
 * ProjectionUsageAggregateRepository - Repository interface for aggregated usage tracking.
 *
 * Owns persistence operations for projected usage ledger rows and
 * aggregate queries by provider, model, and date.
 *
 * @module ProjectionUsageAggregateRepository
 */
import { IsoDateTime } from "@xbetools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionUsageAggregate = Schema.Struct({
  // Idempotency key for one projected usage record (usually the source event id).
  id: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  date: Schema.String,
  turnCount: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
  updatedAt: IsoDateTime,
});
export type ProjectionUsageAggregate = typeof ProjectionUsageAggregate.Type;

export const GetUsageByProviderInput = Schema.Struct({
  provider: Schema.String,
  dateFrom: Schema.String,
  dateTo: Schema.String,
});
export type GetUsageByProviderInput = typeof GetUsageByProviderInput.Type;

export const GetUsageByDateRangeInput = Schema.Struct({
  dateFrom: Schema.String,
  dateTo: Schema.String,
});
export type GetUsageByDateRangeInput = typeof GetUsageByDateRangeInput.Type;

export const GetTopModelsInput = Schema.Struct({
  dateFrom: Schema.String,
  dateTo: Schema.String,
  limit: Schema.Number,
});
export type GetTopModelsInput = typeof GetTopModelsInput.Type;

export const TopModelRow = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  totalTokens: Schema.Number,
  turnCount: Schema.Number,
});
export type TopModelRow = typeof TopModelRow.Type;

export const DailyTotalRow = Schema.Struct({
  date: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  turnCount: Schema.Number,
});
export type DailyTotalRow = typeof DailyTotalRow.Type;

export const ProviderSummaryRow = Schema.Struct({
  provider: Schema.String,
  totalTokens: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  turnCount: Schema.Number,
});
export type ProviderSummaryRow = typeof ProviderSummaryRow.Type;

/**
 * ProjectionUsageAggregateRepositoryShape - Service API for aggregated usage data.
 */
export interface ProjectionUsageAggregateRepositoryShape {
  /** Upsert a usage aggregate row (increment counters). */
  readonly upsert: (
    row: ProjectionUsageAggregate,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Get usage rows by provider within a date range. */
  readonly getByProvider: (
    input: GetUsageByProviderInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionUsageAggregate>, ProjectionRepositoryError>;

  /** Get all usage rows within a date range. */
  readonly getAll: (
    input: GetUsageByDateRangeInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionUsageAggregate>, ProjectionRepositoryError>;

  /** Get top models by total tokens within a date range. */
  readonly getTopModels: (
    input: GetTopModelsInput,
  ) => Effect.Effect<ReadonlyArray<TopModelRow>, ProjectionRepositoryError>;

  /** Get daily totals within a date range. */
  readonly getDailyTotals: (
    input: GetUsageByDateRangeInput,
  ) => Effect.Effect<ReadonlyArray<DailyTotalRow>, ProjectionRepositoryError>;

  /** Get per-provider summaries within a date range. */
  readonly getProviderSummaries: (
    input: GetUsageByDateRangeInput,
  ) => Effect.Effect<ReadonlyArray<ProviderSummaryRow>, ProjectionRepositoryError>;
}

/**
 * ProjectionUsageAggregateRepository - Service tag for usage aggregate persistence.
 */
export class ProjectionUsageAggregateRepository extends ServiceMap.Service<
  ProjectionUsageAggregateRepository,
  ProjectionUsageAggregateRepositoryShape
>()("xbe/persistence/Services/ProjectionUsageAggregate/ProjectionUsageAggregateRepository") {}
