/**
 * GeminiTranscript - Explicit transcript state model for the Gemini agent.
 *
 * Stores the full provider-facing conversation history including user messages,
 * assistant text, function calls, and function results. Enables deterministic
 * recovery and rollback without relying on opaque SDK chat state.
 *
 * @module GeminiTranscript
 */
import type { Content, FunctionCall } from "@google/genai";
import type { TurnId } from "@xbetools/contracts";

/** A single function call request from Gemini within a turn. */
export interface TranscriptFunctionCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** The result of executing a function call. */
export interface TranscriptFunctionResult {
  readonly id: string;
  readonly name: string;
  readonly response: Record<string, unknown>;
}

/** A completed turn in the transcript. */
export interface TranscriptTurn {
  readonly id: TurnId;
  /** The raw user text as the user typed it. */
  readonly userMessage: string;
  /** The provider-facing message sent (may include context wrapping). */
  readonly providerMessage: string | undefined;
  /** Final assistant text produced in this turn. */
  readonly assistantText: string;
  /** Ordered sequence of function calls and results within this turn. */
  readonly toolInteractions: ReadonlyArray<{
    call: TranscriptFunctionCall;
    result: TranscriptFunctionResult;
  }>;
}

/** Convert a completed TranscriptTurn to Gemini Content[] for replay. */
export function turnToContents(turn: TranscriptTurn): Content[] {
  const contents: Content[] = [];

  // User message
  contents.push({
    role: "user",
    parts: [{ text: turn.providerMessage ?? turn.userMessage }],
  });

  // Interleave function calls and results
  for (const interaction of turn.toolInteractions) {
    contents.push({
      role: "model",
      parts: [
        {
          functionCall: {
            id: interaction.call.id,
            name: interaction.call.name,
            args: interaction.call.args,
          },
        },
      ],
    });
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: interaction.result.id,
            name: interaction.result.name,
            response: interaction.result.response,
          },
        },
      ],
    });
  }

  // Final model response
  if (turn.assistantText) {
    contents.push({
      role: "model",
      parts: [{ text: turn.assistantText }],
    });
  }

  return contents;
}

/** Convert an array of completed turns to Gemini Content[] for chat history. */
export function turnsToHistory(turns: ReadonlyArray<TranscriptTurn>): Content[] {
  return turns.flatMap(turnToContents);
}

/** Serialize a transcript turn for persistence in resumeCursor. */
export function serializeTurn(turn: TranscriptTurn): Record<string, unknown> {
  return {
    userMessage: turn.userMessage,
    ...(turn.providerMessage ? { providerMessage: turn.providerMessage } : {}),
    assistantText: turn.assistantText,
    toolInteractions: turn.toolInteractions.map((ti) => ({
      call: { id: ti.call.id, name: ti.call.name, args: ti.call.args },
      result: { id: ti.result.id, name: ti.result.name, response: ti.result.response },
    })),
  };
}

/** Deserialize a persisted turn from resumeCursor. */
export function deserializeTurn(
  raw: Record<string, unknown>,
  id: TurnId,
): TranscriptTurn | undefined {
  if (typeof raw.userMessage !== "string" || typeof raw.assistantText !== "string") {
    return undefined;
  }

  const toolInteractions: TranscriptTurn["toolInteractions"][number][] = [];
  if (Array.isArray(raw.toolInteractions)) {
    for (const ti of raw.toolInteractions) {
      if (!ti || typeof ti !== "object") continue;
      const tiObj = ti as Record<string, unknown>;
      const call = tiObj.call as Record<string, unknown> | undefined;
      const result = tiObj.result as Record<string, unknown> | undefined;
      if (
        call &&
        result &&
        typeof call.id === "string" &&
        typeof call.name === "string" &&
        typeof result.id === "string" &&
        typeof result.name === "string"
      ) {
        toolInteractions.push({
          call: {
            id: call.id,
            name: call.name,
            args: (call.args as Record<string, unknown>) ?? {},
          },
          result: {
            id: result.id,
            name: result.name,
            response: (result.response as Record<string, unknown>) ?? {},
          },
        });
      }
    }
  }

  return {
    id,
    userMessage: raw.userMessage as string,
    providerMessage:
      typeof raw.providerMessage === "string" ? raw.providerMessage : undefined,
    assistantText: raw.assistantText as string,
    toolInteractions,
  };
}

/** Parse Gemini SDK FunctionCall objects into our transcript format. */
export function parseFunctionCalls(
  functionCalls: FunctionCall[],
): TranscriptFunctionCall[] {
  return functionCalls
    .filter((fc) => fc.name)
    .map((fc) => ({
      id: fc.id ?? crypto.randomUUID(),
      name: fc.name!,
      args: fc.args ?? {},
    }));
}
