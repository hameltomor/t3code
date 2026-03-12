import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { HistoryImportCatalogEntry } from "../../persistence/Services/HistoryImportCatalog.ts";
import type { HistoryImportScanError } from "../Errors.ts";

export interface CodexHistoryScannerShape {
  /** Scan Codex state_5.sqlite + rollout files for a workspace root, upsert results into catalog */
  readonly scan: (input: {
    readonly workspaceRoot: string;
    readonly codexHome?: string; // defaults to ~/.codex
  }) => Effect.Effect<ReadonlyArray<HistoryImportCatalogEntry>, HistoryImportScanError>;
}

export class CodexHistoryScannerService extends ServiceMap.Service<
  CodexHistoryScannerService,
  CodexHistoryScannerShape
>()("xbe/historyImport/Services/CodexHistoryScanner/CodexHistoryScannerService") {}
