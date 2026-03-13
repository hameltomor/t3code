import { describe, expect, it } from "vitest";

import {
  normalizeCodexUsage,
  normalizeClaudeUsage,
  normalizeGeminiUsage,
  type CodexThreadTokenUsage,
  type ClaudeRawUsage,
  type GeminiRawUsageMetadata,
} from "./tokenUsageNormalization.ts";

describe("normalizeCodexUsage", () => {
  it("normalizes a real Codex token usage payload", () => {
    const raw: CodexThreadTokenUsage = {
      total: {
        inputTokens: 15420,
        outputTokens: 3200,
        cachedInputTokens: 8000,
        reasoningOutputTokens: 1200,
        totalTokens: 18620,
      },
      last: {
        inputTokens: 5420,
        outputTokens: 1200,
        cachedInputTokens: 3000,
        reasoningOutputTokens: 400,
        totalTokens: 6620,
      },
      modelContextWindow: 400000,
    };

    expect(normalizeCodexUsage(raw)).toEqual({
      inputTokens: 15420,
      outputTokens: 3200,
      totalTokens: 18620,
      cachedInputTokens: 8000,
      reasoningTokens: 1200,
    });
  });

  it("handles zero values", () => {
    const raw: CodexThreadTokenUsage = {
      total: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      },
      last: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      },
    };

    const result = normalizeCodexUsage(raw);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.cachedInputTokens).toBe(0);
    expect(result.reasoningTokens).toBe(0);
  });

  it("ignores last breakdown and modelContextWindow", () => {
    const raw: CodexThreadTokenUsage = {
      total: {
        inputTokens: 100,
        outputTokens: 200,
        cachedInputTokens: 50,
        reasoningOutputTokens: 10,
        totalTokens: 300,
      },
      last: {
        inputTokens: 9999,
        outputTokens: 9999,
        cachedInputTokens: 9999,
        reasoningOutputTokens: 9999,
        totalTokens: 9999,
      },
      modelContextWindow: 128000,
    };

    expect(normalizeCodexUsage(raw)).toEqual({
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      cachedInputTokens: 50,
      reasoningTokens: 10,
    });
  });
});

describe("normalizeClaudeUsage", () => {
  it("normalizes a real Claude usage payload", () => {
    const raw: ClaudeRawUsage = {
      input_tokens: 12000,
      output_tokens: 4500,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 6000,
    };

    expect(normalizeClaudeUsage(raw)).toEqual({
      inputTokens: 12000,
      outputTokens: 4500,
      totalTokens: 16500,
      cachedInputTokens: 6000,
    });
  });

  it("does not map cache_creation_input_tokens", () => {
    const raw: ClaudeRawUsage = {
      input_tokens: 5000,
      output_tokens: 1000,
      cache_creation_input_tokens: 3000,
      cache_read_input_tokens: 0,
    };

    const result = normalizeClaudeUsage(raw);
    // cache_creation_input_tokens is excluded because it's already counted in input_tokens
    expect(result).toEqual({
      inputTokens: 5000,
      outputTokens: 1000,
      totalTokens: 6000,
      cachedInputTokens: 0,
    });
    // Verify no extra field for cache creation
    expect(result).not.toHaveProperty("cacheCreationInputTokens");
  });
});

describe("normalizeGeminiUsage", () => {
  it("normalizes a real Gemini usage payload", () => {
    const raw: GeminiRawUsageMetadata = {
      promptTokenCount: 8000,
      candidatesTokenCount: 2000,
      totalTokenCount: 10000,
      cachedContentTokenCount: 3000,
      thoughtsTokenCount: 500,
    };

    expect(normalizeGeminiUsage(raw)).toEqual({
      inputTokens: 8000,
      outputTokens: 2000,
      totalTokens: 10000,
      cachedInputTokens: 3000,
      reasoningTokens: 500,
    });
  });

  it("handles all-undefined fields", () => {
    const raw: GeminiRawUsageMetadata = {};

    expect(normalizeGeminiUsage(raw)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it("computes totalTokens when totalTokenCount is undefined", () => {
    const raw: GeminiRawUsageMetadata = {
      promptTokenCount: 5000,
      candidatesTokenCount: 1000,
    };

    const result = normalizeGeminiUsage(raw);
    expect(result.totalTokens).toBe(6000);
  });

  it("omits optional fields when source fields are undefined", () => {
    const raw: GeminiRawUsageMetadata = {
      promptTokenCount: 5000,
      candidatesTokenCount: 1000,
      totalTokenCount: 6000,
    };

    const result = normalizeGeminiUsage(raw);
    expect(result).toEqual({
      inputTokens: 5000,
      outputTokens: 1000,
      totalTokens: 6000,
    });
    expect(result).not.toHaveProperty("cachedInputTokens");
    expect(result).not.toHaveProperty("reasoningTokens");
  });
});
