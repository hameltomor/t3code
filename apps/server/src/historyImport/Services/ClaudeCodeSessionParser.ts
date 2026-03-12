import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { HistoryImportParseError } from "../Errors.ts";

/** A parsed message extracted from a Claude Code JSONL session */
export interface ParsedClaudeCodeMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string; // ISO datetime
  readonly turnId: string | null;
  readonly isStreaming: boolean; // true if message was interrupted mid-stream
}

/** A parsed activity extracted from a Claude Code JSONL session */
export interface ParsedClaudeCodeActivity {
  readonly kind: string; // "thinking" | "tool_use" | "tool_result" | "tool_execution"
  readonly summary: string;
  readonly tone: "info" | "tool" | "approval" | "error";
  readonly turnId: string | null;
  readonly createdAt: string;
  readonly payload: unknown;
}

/** Full parse result from a Claude Code JSONL session file */
export interface ClaudeCodeParseResult {
  readonly sessionId: string | null;
  readonly sessionMeta: {
    readonly cwd: string | null;
    readonly model: string | null;
    readonly version: string | null;
    readonly gitBranch: string | null;
  } | null;
  readonly messages: ReadonlyArray<ParsedClaudeCodeMessage>;
  readonly activities: ReadonlyArray<ParsedClaudeCodeActivity>;
  readonly warnings: ReadonlyArray<string>;
  readonly totalLinesProcessed: number;
  readonly totalMessageCount: number; // true count before capping
  readonly totalActivityCount: number; // true count before capping
  readonly lastAssistantUuid: string | null; // for resume seed
}

export interface ClaudeCodeSessionParserShape {
  /**
   * Parse a Claude Code JSONL session file, streaming line-by-line.
   * Maps content blocks: thinking/tool_use to activities, text to messages.
   * Filters sidechain lines and isMeta user messages.
   *
   * @param filePath - Absolute path to the .jsonl session file
   * @param options - Optional parsing options
   */
  readonly parse: (
    filePath: string,
    options?: {
      readonly maxMessages?: number; // cap message extraction (for preview)
      readonly maxActivities?: number; // cap activity extraction (for preview)
    },
  ) => Effect.Effect<ClaudeCodeParseResult, HistoryImportParseError>;
}

export class ClaudeCodeSessionParserService extends ServiceMap.Service<
  ClaudeCodeSessionParserService,
  ClaudeCodeSessionParserShape
>()("xbe/historyImport/Services/ClaudeCodeSessionParser/ClaudeCodeSessionParserService") {}
