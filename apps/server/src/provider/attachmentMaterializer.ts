/**
 * Shared attachment materialization utility.
 *
 * Resolves persisted `ChatAttachment` descriptors to their actual binary
 * content (base64-encoded) so provider adapters can build real multimodal
 * provider payloads instead of text-only placeholders.
 *
 * @module attachmentMaterializer
 */
import { readFileSync } from "node:fs";

import type { ChatAttachment } from "@xbetools/contracts";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { extractTextFromDocument } from "./documentExtractor.ts";

export interface MaterializedImageAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly base64: string;
}

export interface MaterializedFileAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly base64: string;
  readonly extractedText: string | null;
}

/**
 * Read persisted image attachments from disk and return their base64-encoded
 * content. Attachments that cannot be resolved or read are silently skipped;
 * callers should not treat a missing materialization as a fatal error since
 * the attachment metadata is still available for a text-only fallback.
 */
export function materializeImageAttachments(input: {
  readonly stateDir: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}): MaterializedImageAttachment[] {
  const result: MaterializedImageAttachment[] = [];

  for (const attachment of input.attachments) {
    if (attachment.type !== "image") continue;

    const filePath = resolveAttachmentPath({
      stateDir: input.stateDir,
      attachment,
    });
    if (!filePath) continue;

    try {
      const bytes = readFileSync(filePath);
      if (bytes.byteLength === 0) continue;

      result.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        base64: bytes.toString("base64"),
      });
    } catch {
      // Attachment file unreadable — skip silently. The provider adapter
      // will still receive the attachment metadata and can include a text
      // description as a deterministic fallback.
    }
  }

  return result;
}

/**
 * Read persisted file attachments from disk, return their base64-encoded
 * content and extracted text. Used by provider adapters that support native
 * document formats (e.g. Claude/Gemini for PDF) or need extracted text
 * (e.g. Codex).
 */
export async function materializeFileAttachments(input: {
  readonly stateDir: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}): Promise<MaterializedFileAttachment[]> {
  const result: MaterializedFileAttachment[] = [];

  for (const attachment of input.attachments) {
    if (attachment.type !== "file") continue;

    const filePath = resolveAttachmentPath({
      stateDir: input.stateDir,
      attachment,
    });
    if (!filePath) continue;

    try {
      const bytes = readFileSync(filePath);
      if (bytes.byteLength === 0) continue;

      const extractedText = await extractTextFromDocument(filePath, attachment.mimeType);

      result.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        base64: bytes.toString("base64"),
        extractedText,
      });
    } catch {
      // Attachment file unreadable — skip silently.
    }
  }

  return result;
}
