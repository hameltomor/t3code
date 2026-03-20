/**
 * GeminiAuthResolver - Shared auth resolution for Gemini provider.
 *
 * Resolves authentication credentials from multiple sources with a well-defined
 * priority order. Returns a discriminated union describing which auth mode was
 * detected. This module is consumed by both the SDK adapter and health checks.
 *
 * Auth priority (SDK transport):
 *   1. Session-provided API key
 *   2. Layer-provided API key
 *   3. GEMINI_API_KEY environment variable
 *   4. GOOGLE_API_KEY environment variable
 *   5. Application Default Credentials (ADC) via google-auth-library
 *
 * Note: `resolveGeminiAuth()` is mostly pure (env lookup only), but
 * `hasAdcMarkers()` performs a synchronous filesystem existence check
 * for gcloud default credentials. This is an intentional trade-off to
 * detect ADC availability without a full auth handshake.
 *
 * Track A limitation: This module improves auth for the SDK transport only.
 * True CLI subscription parity is handled by Track B (GeminiCliRuntime).
 *
 * @module GeminiAuthResolver
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

// GoogleAuthOptions type from google-auth-library. We define a minimal
// interface here to avoid a direct dependency on google-auth-library types,
// which may not be available as a direct dep in this package.
interface GoogleAuthOptions {
  scopes?: string | string[];
  projectId?: string;
  [key: string]: unknown;
}

// ── Discriminated Auth Result ────────────────────────────────────────

export type GeminiAuthResult =
  | { readonly mode: "apiKey"; readonly apiKey: string }
  | { readonly mode: "googleAuth"; readonly googleAuthOptions: GoogleAuthOptions }
  | { readonly mode: "none"; readonly reason: string };

export interface GeminiAuthSources {
  /** API key from session start input (highest priority). */
  readonly sessionApiKey?: string | undefined;
  /** API key from adapter layer options. */
  readonly layerApiKey?: string | undefined;
  /** Override environment variables for testing. */
  readonly env?: Record<string, string | undefined>;
}

// ── Resolver ─────────────────────────────────────────────────────────

/**
 * Resolve Gemini auth credentials from all available sources.
 *
 * Mostly pure — reads environment variables and performs a single synchronous
 * filesystem existence check for gcloud ADC credentials when no API key is found.
 */
export function resolveGeminiAuth(sources: GeminiAuthSources = {}): GeminiAuthResult {
  const env = sources.env ?? process.env;

  // Priority 1-4: API key sources
  const apiKey =
    nonEmpty(sources.sessionApiKey) ??
    nonEmpty(sources.layerApiKey) ??
    nonEmpty(env.GEMINI_API_KEY) ??
    nonEmpty(env.GOOGLE_API_KEY);

  if (apiKey) {
    return { mode: "apiKey", apiKey };
  }

  // Priority 5: Application Default Credentials (ADC).
  // google-auth-library auto-discovers credentials from:
  //   - GOOGLE_APPLICATION_CREDENTIALS env var
  //   - gcloud CLI default credentials (~/.config/gcloud/application_default_credentials.json)
  //   - GCE metadata service
  // We enable this path when ADC markers are present.
  if (hasAdcMarkers(env)) {
    return {
      mode: "googleAuth",
      googleAuthOptions: {
        scopes: ["https://www.googleapis.com/auth/generative-language"],
      },
    };
  }

  return {
    mode: "none",
    reason:
      "No Gemini auth source found. Set GEMINI_API_KEY or GOOGLE_API_KEY, " +
      "configure Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS), " +
      "or install and sign into the Gemini CLI.",
  };
}

/**
 * Human-readable description of detected auth mode for health/status reporting.
 */
export function describeAuthMode(result: GeminiAuthResult): string {
  switch (result.mode) {
    case "apiKey":
      return "API key configured";
    case "googleAuth":
      return "Google Application Default Credentials available";
    case "none":
      return result.reason;
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

function nonEmpty(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Check for ADC markers without attempting auth.
 * Returns true if there's a reasonable chance ADC will succeed.
 */
function hasAdcMarkers(env: Record<string, string | undefined>): boolean {
  // Explicit credential file
  if (nonEmpty(env.GOOGLE_APPLICATION_CREDENTIALS)) return true;

  // gcloud default credentials (standard location)
  const home = env.HOME ?? env.USERPROFILE;
  if (home) {
    try {
      const adcPath = join(home, ".config", "gcloud", "application_default_credentials.json");
      if (existsSync(adcPath)) return true;
    } catch {
      // Ignore fs errors — fall through to "no markers"
    }
  }

  return false;
}
