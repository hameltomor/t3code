import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, MODEL_OPTIONS_BY_PROVIDER } from "@xbetools/contracts";

import {
  getContextWindowLimit,
  getDefaultModel,
  getDefaultReasoningEffort,
  getModelOptions,
  getReasoningEffortOptions,
  inferProviderForModel,
  normalizeClaudeModelOptions,
  normalizeModelSlug,
  resolveModelSlug,
} from "./model";

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    expect(normalizeModelSlug("5.3")).toBe("gpt-5.3-codex");
    expect(normalizeModelSlug("gpt-5.3")).toBe("gpt-5.3-codex");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });

  it("preserves non-aliased model slugs", () => {
    expect(normalizeModelSlug("gpt-5.2")).toBe("gpt-5.2");
    expect(normalizeModelSlug("gpt-5.2-codex")).toBe("gpt-5.2-codex");
  });

  it("does not leak prototype properties as aliases", () => {
    expect(normalizeModelSlug("toString")).toBe("toString");
    expect(normalizeModelSlug("constructor")).toBe("constructor");
  });
});

describe("resolveModelSlug", () => {
  it("returns default only when the model is missing", () => {
    expect(resolveModelSlug(undefined)).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
    expect(resolveModelSlug(null)).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });

  it("preserves unknown custom models", () => {
    expect(resolveModelSlug("gpt-4.1")).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
    expect(resolveModelSlug("custom/internal-model")).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });

  it("resolves only supported model options", () => {
    for (const model of MODEL_OPTIONS_BY_PROVIDER.codex) {
      expect(resolveModelSlug(model.slug)).toBe(model.slug);
    }
  });
  it("keeps codex defaults for backward compatibility", () => {
    expect(getDefaultModel()).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
    expect(getModelOptions()).toEqual(MODEL_OPTIONS_BY_PROVIDER.codex);
  });
});

describe("inferProviderForModel", () => {
  it("detects codex models", () => {
    expect(inferProviderForModel("gpt-5.3-codex")).toBe("codex");
    expect(inferProviderForModel("5.3")).toBe("codex");
  });

  it("detects claude code models", () => {
    expect(inferProviderForModel("claude-opus-4-6")).toBe("claudeCode");
    expect(inferProviderForModel("opus")).toBe("claudeCode");
  });

  it("detects gemini models", () => {
    expect(inferProviderForModel("gemini-3.1-pro-preview")).toBe("gemini");
    expect(inferProviderForModel("gemini-2.5-pro")).toBe("gemini");
    expect(inferProviderForModel("gemini-3-flash-preview")).toBe("gemini");
  });

  it("returns null for unknown models", () => {
    expect(inferProviderForModel("custom/internal-model")).toBeNull();
  });
});

describe("getReasoningEffortOptions", () => {
  it("returns codex reasoning options for codex", () => {
    expect(getReasoningEffortOptions("codex")).toEqual(["xhigh", "high", "medium", "low"]);
  });

  it("returns claude reasoning options based on model capabilities", () => {
    expect(getReasoningEffortOptions("claudeCode", "claude-opus-4-6")).toEqual([
      "low",
      "medium",
      "high",
      "max",
      "ultrathink",
    ]);
    expect(getReasoningEffortOptions("claudeCode", "claude-sonnet-4-6")).toEqual([
      "low",
      "medium",
      "high",
      "ultrathink",
    ]);
    expect(getReasoningEffortOptions("claudeCode", "claude-haiku-4-5")).toEqual([]);
  });
});

describe("normalizeClaudeModelOptions", () => {
  it("preserves supported Claude effort and fast mode values", () => {
    expect(
      normalizeClaudeModelOptions("claude-opus-4-6", {
        effort: "max",
        fastMode: true,
      }),
    ).toEqual({
      effort: "max",
      fastMode: true,
    });
  });

  it("drops unsupported Claude effort values for the selected model", () => {
    expect(
      normalizeClaudeModelOptions("claude-haiku-4-5", {
        effort: "high",
        thinking: false,
        fastMode: true,
      }),
    ).toEqual({
      thinking: false,
    });
  });
});

describe("getDefaultReasoningEffort", () => {
  it("returns provider-scoped defaults", () => {
    expect(getDefaultReasoningEffort("codex")).toBe("high");
  });
});

describe("getContextWindowLimit", () => {
  it("resolves direct slug lookup", () => {
    expect(getContextWindowLimit("gpt-5.4")).toEqual({
      maxInputTokens: 1_050_000,
      maxOutputTokens: 128_000,
    });
  });

  it("resolves alias with provider hint", () => {
    expect(getContextWindowLimit("opus", "claudeCode")).toEqual({
      maxInputTokens: 200_000,
      maxOutputTokens: 128_000,
    });
  });

  it("resolves alias without provider hint (tries all providers)", () => {
    expect(getContextWindowLimit("opus")).toEqual({
      maxInputTokens: 200_000,
      maxOutputTokens: 128_000,
    });
  });

  it("returns null for unknown models", () => {
    expect(getContextWindowLimit("gpt-99")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(getContextWindowLimit(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(getContextWindowLimit(undefined)).toBeNull();
  });

  it("covers all catalog models in MODEL_OPTIONS_BY_PROVIDER", () => {
    const providers = ["codex", "claudeCode", "gemini"] as const;
    for (const provider of providers) {
      for (const model of MODEL_OPTIONS_BY_PROVIDER[provider]) {
        const limit = getContextWindowLimit(model.slug);
        expect(limit, `Missing limit for ${provider}/${model.slug}`).not.toBeNull();
        expect(limit!.maxInputTokens).toBeGreaterThan(0);
        expect(limit!.maxOutputTokens).toBeGreaterThan(0);
      }
    }
  });

  it("resolves Claude alias variants", () => {
    const sonnet = getContextWindowLimit("sonnet");
    expect(sonnet).toEqual({ maxInputTokens: 200_000, maxOutputTokens: 64_000 });

    const haiku = getContextWindowLimit("haiku");
    expect(haiku).toEqual({ maxInputTokens: 200_000, maxOutputTokens: 64_000 });
  });

  it("resolves Gemini alias variants", () => {
    const pro = getContextWindowLimit("pro", "gemini");
    expect(pro).toEqual({ maxInputTokens: 1_048_576, maxOutputTokens: 65_536 });

    const flash = getContextWindowLimit("flash", "gemini");
    expect(flash).toEqual({ maxInputTokens: 1_048_576, maxOutputTokens: 65_536 });
  });
});
