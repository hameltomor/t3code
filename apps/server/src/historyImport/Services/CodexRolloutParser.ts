import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { HistoryImportParseError } from "../Errors.ts";

/** A parsed message extracted from a Codex rollout */
export interface ParsedCodexMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly createdAt: string; // ISO datetime
  readonly turnId: string | null;
  readonly isStreaming: boolean; // true if message was interrupted mid-stream
}

/** A parsed activity extracted from a Codex rollout */
export interface ParsedCodexActivity {
  readonly kind: string; // "exec_command" | "approval_request" | "patch_approval" | "error" | "compaction" | ...
  readonly summary: string;
  readonly tone: "info" | "tool" | "approval" | "error";
  readonly turnId: string | null;
  readonly createdAt: string;
  readonly payload: unknown;
}

/** Full parse result from a Codex rollout file */
export interface CodexRolloutParseResult {
  readonly sessionId: string | null;
  readonly sessionMeta: {
    readonly cwd: string | null;
    readonly model: string | null;
    readonly source: unknown;
    readonly cliVersion: string | null;
    readonly gitBranch: string | null;
    readonly gitCommit: string | null;
  } | null;
  readonly messages: ReadonlyArray<ParsedCodexMessage>;
  readonly activities: ReadonlyArray<ParsedCodexActivity>;
  readonly warnings: ReadonlyArray<string>;
  readonly totalLinesProcessed: number;
  readonly compactionCount: number;
}

export interface CodexRolloutParserShape {
  /**
   * Parse a Codex rollout file, streaming line-by-line.
   * Handles compaction, encrypted content, subagent detection, and incomplete messages.
   *
   * @param filePath - Absolute path to the .jsonl rollout file
   * @param options - Optional parsing options
   */
  readonly parse: (
    filePath: string,
    options?: {
      readonly maxMessages?: number; // cap message extraction (for preview)
      readonly maxActivities?: number; // cap activity extraction (for preview)
    },
  ) => Effect.Effect<CodexRolloutParseResult, HistoryImportParseError>;
}

export class CodexRolloutParserService extends ServiceMap.Service<
  CodexRolloutParserService,
  CodexRolloutParserShape
>()("xbe/historyImport/Services/CodexRolloutParser/CodexRolloutParserService") {}
