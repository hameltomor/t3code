import {
  CODEX_REASONING_EFFORT_OPTIONS,
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_OPTIONS_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  type CodexReasoningEffort,
  type ModelSlug,
  type ProviderKind,
} from "@xbetools/contracts";

type CatalogProvider = keyof typeof MODEL_OPTIONS_BY_PROVIDER;
const PROVIDERS: ProviderKind[] = ["codex", "claudeCode", "gemini"];

const MODEL_SLUG_SET_BY_PROVIDER: Record<CatalogProvider, ReadonlySet<ModelSlug>> = {
  codex: new Set(MODEL_OPTIONS_BY_PROVIDER.codex.map((option) => option.slug)),
  claudeCode: new Set(MODEL_OPTIONS_BY_PROVIDER.claudeCode.map((option) => option.slug)),
  gemini: new Set(MODEL_OPTIONS_BY_PROVIDER.gemini.map((option) => option.slug)),
};

export function getModelOptions(provider: ProviderKind = "codex") {
  return MODEL_OPTIONS_BY_PROVIDER[provider];
}

export function getDefaultModel(provider: ProviderKind = "codex"): ModelSlug {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] as Record<string, ModelSlug>;
  const aliased = aliases[trimmed];
  return typeof aliased === "string" ? aliased : (trimmed as ModelSlug);
}

export function resolveModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) {
    return getDefaultModel(provider);
  }

  return MODEL_SLUG_SET_BY_PROVIDER[provider].has(normalized)
    ? normalized
    : getDefaultModel(provider);
}

export function resolveModelSlugForProvider(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelSlug {
  return resolveModelSlug(model, provider);
}

export function inferProviderForModel(
  model: string | null | undefined,
): ProviderKind | null {
  for (const provider of PROVIDERS) {
    const normalized = normalizeModelSlug(model, provider);
    if (normalized && MODEL_SLUG_SET_BY_PROVIDER[provider].has(normalized)) {
      return provider;
    }
  }

  return null;
}

export function getReasoningEffortOptions(
  provider: ProviderKind = "codex",
): ReadonlyArray<CodexReasoningEffort> {
  return provider === "codex" ? CODEX_REASONING_EFFORT_OPTIONS : [];
}

export function getDefaultReasoningEffort(provider: "codex"): CodexReasoningEffort;
export function getDefaultReasoningEffort(provider: ProviderKind): CodexReasoningEffort | null;
export function getDefaultReasoningEffort(
  provider: ProviderKind = "codex",
): CodexReasoningEffort | null {
  return provider === "codex" ? "high" : null;
}

// ---------------------------------------------------------------------------
// Context Window Registry
// ---------------------------------------------------------------------------

export interface ContextWindowLimit {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

const CONTEXT_WINDOW_LIMITS: Readonly<Record<string, ContextWindowLimit>> = {
  // Codex / OpenAI
  "gpt-5.4": { maxInputTokens: 1_050_000, maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.4, verified 2026-03
  "gpt-5.3-codex": { maxInputTokens: 400_000, maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.3-codex, verified 2026-03
  "gpt-5.3-codex-spark": { maxInputTokens: 128_000, maxOutputTokens: 128_000 }, // openai.com blog, 2026-02 -- MEDIUM confidence (research preview)
  "gpt-5.2-codex": { maxInputTokens: 400_000, maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.2-codex, verified 2026-03
  "gpt-5.2": { maxInputTokens: 400_000, maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.2, verified 2026-03

  // Claude Code / Anthropic
  "claude-opus-4-6": { maxInputTokens: 200_000, maxOutputTokens: 128_000 }, // platform.claude.com/docs, verified 2026-03
  "claude-sonnet-4-6": { maxInputTokens: 200_000, maxOutputTokens: 64_000 }, // platform.claude.com/docs, verified 2026-03
  "claude-haiku-4-5": { maxInputTokens: 200_000, maxOutputTokens: 64_000 }, // platform.claude.com/docs, verified 2026-03

  // Gemini / Google
  "gemini-3.1-pro-preview": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai, 2026-03 -- MEDIUM confidence (preview)
  "gemini-3-flash-preview": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai, 2026-03 -- MEDIUM confidence (preview)
  "gemini-3.1-flash-lite-preview": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai + deepmind, 2026-03 -- MEDIUM confidence (preview)
  "gemini-2.5-pro": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // cloud.google.com, verified 2026-03
  "gemini-2.5-flash": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // verified 2026-03
  "gemini-2.5-flash-lite": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai, verified 2026-03
};

/**
 * Resolve the context window limits for a model slug.
 *
 * Attempts a direct lookup first, then falls back to alias resolution via
 * `normalizeModelSlug`. Returns `null` for unknown models -- never guesses.
 */
export function getContextWindowLimit(
  model: string | null | undefined,
  provider?: ProviderKind,
): ContextWindowLimit | null {
  if (!model) return null;

  // Try direct lookup first
  const direct = CONTEXT_WINDOW_LIMITS[model];
  if (direct) return direct;

  // Try alias resolution using existing normalizeModelSlug
  if (provider) {
    const normalized = normalizeModelSlug(model, provider);
    if (normalized) {
      const resolved = CONTEXT_WINDOW_LIMITS[normalized];
      if (resolved) return resolved;
    }
  } else {
    // Try all providers for alias resolution
    for (const p of PROVIDERS) {
      const normalized = normalizeModelSlug(model, p);
      if (normalized && CONTEXT_WINDOW_LIMITS[normalized]) {
        return CONTEXT_WINDOW_LIMITS[normalized]!;
      }
    }
  }

  // Unknown model -- return null, never guess (REG-03)
  return null;
}

export { CODEX_REASONING_EFFORT_OPTIONS };
