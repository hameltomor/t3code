/**
 * Shared fingerprint computation utility.
 *
 * Computes a SHA-256 fingerprint from session ID, file size, mtime,
 * and head/tail sample buffers. Used by both CodexHistoryScanner
 * and ClaudeCodeHistoryScanner for deduplication and validation.
 *
 * @module fingerprint
 */
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";

import { Effect } from "effect";

import { HistoryImportScanError } from "./Errors.ts";

export const SAMPLE_SIZE = 4096;

export function computeFingerprint(
  sessionId: string,
  filePath: string,
): Effect.Effect<string, HistoryImportScanError> {
  return Effect.tryPromise({
    try: async () => {
      const fileStat = await stat(filePath);
      const fileSize = fileStat.size;
      const mtimeMs = fileStat.mtimeMs;

      const headBuf = Buffer.alloc(Math.min(SAMPLE_SIZE, fileSize));
      const handle = await open(filePath, "r");
      try {
        await handle.read(headBuf, 0, headBuf.length, 0);

        let tailBuf = Buffer.alloc(0);
        if (fileSize > SAMPLE_SIZE) {
          tailBuf = Buffer.alloc(Math.min(SAMPLE_SIZE, fileSize));
          await handle.read(tailBuf, 0, tailBuf.length, Math.max(0, fileSize - SAMPLE_SIZE));
        }

        const hash = createHash("sha256");
        hash.update(sessionId);
        hash.update(String(fileSize));
        hash.update(String(mtimeMs));
        hash.update(headBuf);
        if (tailBuf.length > 0) hash.update(tailBuf);
        return hash.digest("hex");
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      new HistoryImportScanError({
        message: `Failed to compute fingerprint for ${filePath}`,
        cause,
      }),
  });
}
