import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type {
  HistoryImportConversationSummary,
  HistoryImportConversationPreview,
  HistoryImportExecuteInput,
  HistoryImportExecuteResult,
  HistoryImportListInput,
  HistoryImportPreviewInput,
} from "@xbetools/contracts";
import type {
  HistoryImportScanError,
  HistoryImportParseError,
  HistoryImportMaterializeError,
  HistoryImportNotFoundError,
} from "../Errors.ts";

export type HistoryImportError =
  | HistoryImportScanError
  | HistoryImportParseError
  | HistoryImportMaterializeError
  | HistoryImportNotFoundError;

export interface HistoryImportServiceShape {
  /**
   * Scan providers and return catalog entries for a workspace.
   * Triggers a fresh scan of Codex (and future providers), then returns catalog.
   */
  readonly list: (
    input: HistoryImportListInput,
  ) => Effect.Effect<ReadonlyArray<HistoryImportConversationSummary>, HistoryImportError>;

  /**
   * Parse a rollout file and return a preview with capped messages and activities.
   */
  readonly preview: (
    input: HistoryImportPreviewInput,
  ) => Effect.Effect<HistoryImportConversationPreview, HistoryImportError>;

  /**
   * Import a catalog entry into an XBE thread. (Stub in this plan -- implemented in Plan 03)
   */
  readonly execute: (
    input: HistoryImportExecuteInput,
  ) => Effect.Effect<HistoryImportExecuteResult, HistoryImportError>;
}

export class HistoryImportServiceService extends ServiceMap.Service<
  HistoryImportServiceService,
  HistoryImportServiceShape
>()("xbe/historyImport/Services/HistoryImportService/HistoryImportServiceService") {}
