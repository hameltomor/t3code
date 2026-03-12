import { Schema } from "effect";

// ── History Import Domain Errors ─────────────────────────────────────

/** Scanner failures: SQLite errors, filesystem errors, glob errors */
export class HistoryImportScanError extends Schema.TaggedErrorClass<HistoryImportScanError>()(
  "HistoryImportScanError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/** JSONL parsing failures: individual line or file-level */
export class HistoryImportParseError extends Schema.TaggedErrorClass<HistoryImportParseError>()(
  "HistoryImportParseError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/** Import materialization failures: dispatch errors, dedup conflicts */
export class HistoryImportMaterializeError extends Schema.TaggedErrorClass<HistoryImportMaterializeError>()(
  "HistoryImportMaterializeError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/** Catalog entry not found */
export class HistoryImportNotFoundError extends Schema.TaggedErrorClass<HistoryImportNotFoundError>()(
  "HistoryImportNotFoundError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
