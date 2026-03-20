import { describe, it, expect } from "vitest";
import { resolveGeminiAuth, describeAuthMode } from "./GeminiAuthResolver.ts";

describe("GeminiAuthResolver", () => {
  describe("resolveGeminiAuth", () => {
    it("returns apiKey mode from sessionApiKey (highest priority)", () => {
      const result = resolveGeminiAuth({
        sessionApiKey: "session-key",
        layerApiKey: "layer-key",
        env: { GEMINI_API_KEY: "env-key" },
      });
      expect(result).toEqual({ mode: "apiKey", apiKey: "session-key" });
    });

    it("returns apiKey mode from layerApiKey when no session key", () => {
      const result = resolveGeminiAuth({
        layerApiKey: "layer-key",
        env: { GEMINI_API_KEY: "env-key" },
      });
      expect(result).toEqual({ mode: "apiKey", apiKey: "layer-key" });
    });

    it("returns apiKey mode from GEMINI_API_KEY env var", () => {
      const result = resolveGeminiAuth({
        env: { GEMINI_API_KEY: "env-key" },
      });
      expect(result).toEqual({ mode: "apiKey", apiKey: "env-key" });
    });

    it("returns apiKey mode from GOOGLE_API_KEY env var", () => {
      const result = resolveGeminiAuth({
        env: { GOOGLE_API_KEY: "google-key" },
      });
      expect(result).toEqual({ mode: "apiKey", apiKey: "google-key" });
    });

    it("prefers GEMINI_API_KEY over GOOGLE_API_KEY", () => {
      const result = resolveGeminiAuth({
        env: { GEMINI_API_KEY: "gemini-key", GOOGLE_API_KEY: "google-key" },
      });
      expect(result).toEqual({ mode: "apiKey", apiKey: "gemini-key" });
    });

    it("ignores empty/whitespace API keys", () => {
      const result = resolveGeminiAuth({
        sessionApiKey: "  ",
        layerApiKey: "",
        env: { GEMINI_API_KEY: "  ", GOOGLE_API_KEY: "" },
      });
      expect(result.mode).toBe("none");
    });

    it("returns none when no auth sources available", () => {
      const result = resolveGeminiAuth({ env: {} });
      expect(result.mode).toBe("none");
      if (result.mode === "none") {
        expect(result.reason).toContain("No Gemini auth source found");
      }
    });

    it("returns googleAuth when GOOGLE_APPLICATION_CREDENTIALS is set", () => {
      const result = resolveGeminiAuth({
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/path/to/creds.json" },
      });
      expect(result.mode).toBe("googleAuth");
      if (result.mode === "googleAuth") {
        expect(result.googleAuthOptions.scopes).toBeDefined();
      }
    });
  });

  describe("describeAuthMode", () => {
    it("describes apiKey mode", () => {
      const desc = describeAuthMode({ mode: "apiKey", apiKey: "key" });
      expect(desc).toBe("API key configured");
    });

    it("describes googleAuth mode", () => {
      const desc = describeAuthMode({ mode: "googleAuth", googleAuthOptions: {} });
      expect(desc).toBe("Google Application Default Credentials available");
    });

    it("describes none mode with reason", () => {
      const desc = describeAuthMode({ mode: "none", reason: "No auth found" });
      expect(desc).toBe("No auth found");
    });
  });
});
