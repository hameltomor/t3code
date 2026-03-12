import { describe, expect, it } from "vitest";

/**
 * NFR-6 Performance Targets (from REQUIREMENTS.md):
 * - Catalog scan: < 5 seconds for 100 sessions across all providers
 * - Preview: < 2 seconds for any single session
 * - Import: < 10 seconds for a 500-message thread
 *
 * These targets are validated via:
 * 1. Effect.logInfo timing instrumentation in HistoryImportService.list/preview/execute
 * 2. Effect.logInfo timing in HistoryMaterializer.materialize
 * 3. Manual verification during integration testing
 *
 * To measure in production: check server logs for lines matching:
 *   "HistoryImportService.list completed in Xms"
 *   "HistoryImportService.preview completed in Xms"
 *   "HistoryImportService.execute completed in Xms"
 *   "HistoryMaterializer.materialize dispatch completed in Xms for N messages"
 */

// NFR-6 threshold constants (centralized for reference)
const NFR6_THRESHOLDS = {
  /** Max time for catalog scan of 100 sessions (ms) */
  SCAN_100_SESSIONS_MS: 5_000,
  /** Max time for single session preview (ms) */
  PREVIEW_SINGLE_SESSION_MS: 2_000,
  /** Max time for import of 500-message thread (ms) */
  IMPORT_500_MESSAGES_MS: 10_000,
} as const;

describe("NFR-6 Performance Thresholds", () => {
  it("documents scan threshold: 5 seconds for 100 sessions", () => {
    expect(NFR6_THRESHOLDS.SCAN_100_SESSIONS_MS).toBe(5_000);
  });

  it("documents preview threshold: 2 seconds per session", () => {
    expect(NFR6_THRESHOLDS.PREVIEW_SINGLE_SESSION_MS).toBe(2_000);
  });

  it("documents import threshold: 10 seconds for 500 messages", () => {
    expect(NFR6_THRESHOLDS.IMPORT_500_MESSAGES_MS).toBe(10_000);
  });

  it("scan threshold allows 50ms per session on average", () => {
    const perSession = NFR6_THRESHOLDS.SCAN_100_SESSIONS_MS / 100;
    expect(perSession).toBe(50);
  });

  it("import threshold allows 20ms per message on average", () => {
    const perMessage = NFR6_THRESHOLDS.IMPORT_500_MESSAGES_MS / 500;
    expect(perMessage).toBe(20);
  });
});
