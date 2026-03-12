import { IsoDateTime } from "@xbetools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const HistoryImportCatalogEntry = Schema.Struct({
  catalogId: Schema.String,
  providerName: Schema.String,
  workspaceRoot: Schema.String,
  cwd: Schema.String,
  title: Schema.String,
  model: Schema.NullOr(Schema.String),
  messageCount: Schema.Number,
  turnCount: Schema.Number,
  providerConversationId: Schema.NullOr(Schema.String),
  providerSessionId: Schema.NullOr(Schema.String),
  resumeAnchorId: Schema.NullOr(Schema.String),
  sourceKind: Schema.String,
  sourcePath: Schema.String,
  linkMode: Schema.String,
  validationStatus: Schema.String,
  warningsJson: Schema.String,
  fingerprint: Schema.String,
  rawMetadataJson: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastScannedAt: IsoDateTime,
});
export type HistoryImportCatalogEntry = typeof HistoryImportCatalogEntry.Type;

export const ListHistoryImportCatalogInput = Schema.Struct({
  workspaceRoot: Schema.String,
  providerName: Schema.optional(Schema.String),
});
export type ListHistoryImportCatalogInput = typeof ListHistoryImportCatalogInput.Type;

export const DeleteHistoryImportCatalogInput = Schema.Struct({
  catalogId: Schema.String,
});
export type DeleteHistoryImportCatalogInput = typeof DeleteHistoryImportCatalogInput.Type;

export const GetByCatalogIdInput = Schema.Struct({
  catalogId: Schema.String,
});
export type GetByCatalogIdInput = typeof GetByCatalogIdInput.Type;

export interface HistoryImportCatalogRepositoryShape {
  readonly upsert: (
    entry: HistoryImportCatalogEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listByWorkspace: (
    input: ListHistoryImportCatalogInput,
  ) => Effect.Effect<ReadonlyArray<HistoryImportCatalogEntry>, ProjectionRepositoryError>;

  readonly getByCatalogId: (
    input: GetByCatalogIdInput,
  ) => Effect.Effect<HistoryImportCatalogEntry | null, ProjectionRepositoryError>;

  readonly deleteByCatalogId: (
    input: DeleteHistoryImportCatalogInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class HistoryImportCatalogRepository extends ServiceMap.Service<
  HistoryImportCatalogRepository,
  HistoryImportCatalogRepositoryShape
>()("xbe/persistence/Services/HistoryImportCatalog/HistoryImportCatalogRepository") {}
