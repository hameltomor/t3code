import {
  CLAUDE_CODE_EFFORT_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
  MODEL_OPTIONS_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  type ClaudeCodeEffort,
  type ClaudeCodeModelOptions,
  type CodexModelOptions,
  type CodexReasoningEffort,
  type ModelSlug,
  type ProviderKind,
  type ProviderReasoningEffort,
} from "@xbetools/contracts";

const PROVIDERS: ProviderKind[] = ["codex", "claudeCode", "gemini"];
const CLAUDE_OPUS_4_6_MODEL = "claude-opus-4-6";
const CLAUDE_SONNET_4_6_MODEL = "claude-sonnet-4-6";
const CLAUDE_HAIKU_4_5_MODEL = "claude-haiku-4-5";

const MODEL_SLUG_SET_BY_PROVIDER: Record<ProviderKind, ReadonlySet<ModelSlug>> = {
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

export function supportsClaudeFastMode(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeCode") === CLAUDE_OPUS_4_6_MODEL;
}

export function supportsClaudeAdaptiveReasoning(model: string | null | undefined): boolean {
  const normalized = normalizeModelSlug(model, "claudeCode");
  return normalized === CLAUDE_OPUS_4_6_MODEL || normalized === CLAUDE_SONNET_4_6_MODEL;
}

export function supportsClaudeMaxEffort(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeCode") === CLAUDE_OPUS_4_6_MODEL;
}

export function supportsClaudeUltrathinkKeyword(model: string | null | undefined): boolean {
  return supportsClaudeAdaptiveReasoning(model);
}

export function supportsClaudeThinkingToggle(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeCode") === CLAUDE_HAIKU_4_5_MODEL;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
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
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
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

  return typeof model === "string" && model.trim().startsWith("claude-") ? "claudeCode" : null;
}

export function getReasoningEffortOptions(provider: "codex"): ReadonlyArray<CodexReasoningEffort>;
export function getReasoningEffortOptions(
  provider: "claudeCode",
  model?: string | null | undefined,
): ReadonlyArray<ClaudeCodeEffort>;
export function getReasoningEffortOptions(
  provider?: ProviderKind,
  model?: string | null | undefined,
): ReadonlyArray<ProviderReasoningEffort>;
export function getReasoningEffortOptions(
  provider: ProviderKind = "codex",
  model?: string | null | undefined,
): ReadonlyArray<ProviderReasoningEffort> {
  if (provider === "claudeCode") {
    if (supportsClaudeMaxEffort(model)) {
      return ["low", "medium", "high", "max", "ultrathink"];
    }
    if (supportsClaudeAdaptiveReasoning(model)) {
      return ["low", "medium", "high", "ultrathink"];
    }
    return [];
  }
  if (provider === "gemini") {
    return [];
  }
  return CODEX_REASONING_EFFORT_OPTIONS;
}

export function getDefaultReasoningEffort(provider: "codex"): CodexReasoningEffort;
export function getDefaultReasoningEffort(provider: "claudeCode"): ClaudeCodeEffort;
export function getDefaultReasoningEffort(provider: "gemini"): null;
export function getDefaultReasoningEffort(
  provider: ProviderKind,
): ProviderReasoningEffort | null;
export function getDefaultReasoningEffort(
  provider: ProviderKind = "codex",
): ProviderReasoningEffort | null {
  return DEFAULT_REASONING_EFFORT_BY_PROVIDER[provider];
}

export function resolveReasoningEffortForProvider(
  provider: "codex",
  effort: string | null | undefined,
): CodexReasoningEffort | null;
export function resolveReasoningEffortForProvider(
  provider: "claudeCode",
  effort: string | null | undefined,
  model?: string | null | undefined,
): ClaudeCodeEffort | null;
export function resolveReasoningEffortForProvider(
  provider: "gemini",
  effort: string | null | undefined,
): null;
export function resolveReasoningEffortForProvider(
  provider: ProviderKind,
  effort: string | null | undefined,
  model?: string | null | undefined,
): ProviderReasoningEffort | null;
export function resolveReasoningEffortForProvider(
  provider: ProviderKind,
  effort: string | null | undefined,
  model?: string | null | undefined,
): ProviderReasoningEffort | null {
  if (typeof effort !== "string") {
    return null;
  }

  const trimmed = effort.trim();
  if (!trimmed) {
    return null;
  }

  const options = getReasoningEffortOptions(provider, model) as ReadonlyArray<string>;
  return options.includes(trimmed) ? (trimmed as ProviderReasoningEffort) : null;
}

export function getEffectiveClaudeCodeEffort(
  effort: ClaudeCodeEffort | null | undefined,
): Exclude<ClaudeCodeEffort, "ultrathink"> | null {
  if (!effort) {
    return null;
  }
  return effort === "ultrathink" ? null : effort;
}

export function normalizeCodexModelOptions(
  modelOptions: CodexModelOptions | null | undefined,
): CodexModelOptions | undefined {
  const defaultReasoningEffort = getDefaultReasoningEffort("codex");
  const reasoningEffort =
    resolveReasoningEffortForProvider("codex", modelOptions?.reasoningEffort) ??
    defaultReasoningEffort;
  const fastModeEnabled = modelOptions?.fastMode === true;
  const nextOptions: CodexModelOptions = {
    ...(reasoningEffort !== defaultReasoningEffort ? { reasoningEffort } : {}),
    ...(fastModeEnabled ? { fastMode: true } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeClaudeModelOptions(
  model: string | null | undefined,
  modelOptions: ClaudeCodeModelOptions | null | undefined,
): ClaudeCodeModelOptions | undefined {
  const reasoningOptions = getReasoningEffortOptions("claudeCode", model);
  const defaultReasoningEffort = getDefaultReasoningEffort("claudeCode");
  const resolvedEffort = resolveReasoningEffortForProvider("claudeCode", modelOptions?.effort, model);
  const effort =
    resolvedEffort &&
    resolvedEffort !== "ultrathink" &&
    reasoningOptions.includes(resolvedEffort) &&
    resolvedEffort !== defaultReasoningEffort
      ? resolvedEffort
      : undefined;
  const thinking =
    supportsClaudeThinkingToggle(model) && modelOptions?.thinking === false ? false : undefined;
  const fastMode =
    supportsClaudeFastMode(model) && modelOptions?.fastMode === true ? true : undefined;
  const nextOptions: ClaudeCodeModelOptions = {
    ...(thinking === false ? { thinking: false } : {}),
    ...(effort ? { effort } : {}),
    ...(fastMode ? { fastMode: true } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeCodeEffort | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (effort !== "ultrathink") {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
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
  "gpt-5.4": { maxInputTokens: 1_050_000, maxOutputTokens: 128_000 },
  "gpt-5.3-codex": { maxInputTokens: 400_000, maxOutputTokens: 128_000 },
  "gpt-5.3-codex-spark": { maxInputTokens: 128_000, maxOutputTokens: 128_000 },
  "gpt-5.2-codex": { maxInputTokens: 400_000, maxOutputTokens: 128_000 },
  "gpt-5.2": { maxInputTokens: 400_000, maxOutputTokens: 128_000 },

  // Claude Code / Anthropic
  "claude-opus-4-6": { maxInputTokens: 200_000, maxOutputTokens: 128_000 },
  "claude-sonnet-4-6": { maxInputTokens: 200_000, maxOutputTokens: 64_000 },
  "claude-haiku-4-5": { maxInputTokens: 200_000, maxOutputTokens: 64_000 },

  // Gemini / Google
  "gemini-3.1-pro-preview": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-3-flash-preview": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-3.1-flash-lite-preview": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-2.5-pro": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-2.5-flash": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-2.5-flash-lite": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 },
};

export function getContextWindowLimit(
  model: string | null | undefined,
  provider?: ProviderKind,
): ContextWindowLimit | null {
  if (!model) return null;

  const direct = CONTEXT_WINDOW_LIMITS[model];
  if (direct) return direct;

  if (provider) {
    const normalized = normalizeModelSlug(model, provider);
    if (normalized) {
      const resolved = CONTEXT_WINDOW_LIMITS[normalized];
      if (resolved) return resolved;
    }
  } else {
    for (const p of PROVIDERS) {
      const normalized = normalizeModelSlug(model, p);
      if (normalized && CONTEXT_WINDOW_LIMITS[normalized]) {
        return CONTEXT_WINDOW_LIMITS[normalized]!;
      }
    }
  }

  return null;
}

export { CLAUDE_CODE_EFFORT_OPTIONS, CODEX_REASONING_EFFORT_OPTIONS };
