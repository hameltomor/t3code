import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { HistoryImportExecuteResult } from "@xbetools/contracts";
import type { HistoryImportMaterializeError } from "../Errors.ts";
import type { ParsedCodexMessage, ParsedCodexActivity } from "./CodexRolloutParser.ts";

export interface MaterializeInput {
  readonly projectId: string;
  readonly title: string;
  readonly model: string;
  readonly runtimeMode: "approval-required" | "full-access";
  readonly interactionMode: "default" | "plan";
  readonly linkMode: "native-resume" | "transcript-replay" | "snapshot-only";
  readonly providerThreadId: string; // e.g. "codex:<uuid>"
  readonly providerName: "codex" | "claudeCode" | "gemini";
  readonly messages: ReadonlyArray<ParsedCodexMessage>;
  readonly activities: ReadonlyArray<ParsedCodexActivity>;
  readonly sourcePath: string;
  readonly sourceFingerprint: string;
  readonly originalWorkspaceRoot: string;
  readonly originalCwd: string;
  readonly providerConversationId: string | null;
  readonly providerSessionId: string | null;
  readonly resumeAnchorId: string | null;
}

export interface HistoryMaterializerShape {
  readonly materialize: (
    input: MaterializeInput,
  ) => Effect.Effect<HistoryImportExecuteResult, HistoryImportMaterializeError>;
}

export class HistoryMaterializerService extends ServiceMap.Service<
  HistoryMaterializerService,
  HistoryMaterializerShape
>()("xbe/historyImport/Services/HistoryMaterializer/HistoryMaterializerService") {}
