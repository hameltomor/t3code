import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { HistoryImportCatalogEntry } from "../../persistence/Services/HistoryImportCatalog.ts";
import type { HistoryImportScanError } from "../Errors.ts";

export interface ClaudeCodeHistoryScannerShape {
  /** Scan Claude Code projects directory for sessions matching a workspace root, upsert results into catalog */
  readonly scan: (input: {
    readonly workspaceRoot: string;
    readonly claudeHome?: string; // defaults to ~/.claude
  }) => Effect.Effect<ReadonlyArray<HistoryImportCatalogEntry>, HistoryImportScanError>;
}

export class ClaudeCodeHistoryScannerService extends ServiceMap.Service<
  ClaudeCodeHistoryScannerService,
  ClaudeCodeHistoryScannerShape
>()("xbe/historyImport/Services/ClaudeCodeHistoryScanner/ClaudeCodeHistoryScannerService") {}
