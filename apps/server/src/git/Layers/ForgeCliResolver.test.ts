import { describe, it, expect } from "vitest";

import { resolveForgeProvider } from "./ForgeCliResolver";

describe("resolveForgeProvider", () => {
  // ── Precedence ──

  it("returns github from git config", () => {
    expect(resolveForgeProvider("github", undefined, null)).toBe("github");
  });

  it("returns gitlab from git config", () => {
    expect(resolveForgeProvider("gitlab", undefined, null)).toBe("gitlab");
  });

  it("git config takes precedence over env var", () => {
    expect(resolveForgeProvider("github", "gitlab", null)).toBe("github");
  });

  it("git config takes precedence over remote URL", () => {
    expect(
      resolveForgeProvider("gitlab", undefined, "git@github.com:org/repo.git"),
    ).toBe("gitlab");
  });

  it("git config takes precedence over both env and remote URL", () => {
    expect(
      resolveForgeProvider("github", "gitlab", "git@gitlab.com:group/project.git"),
    ).toBe("github");
  });

  // ── Env var ──

  it("returns github from env var when config is null", () => {
    expect(resolveForgeProvider(null, "github", null)).toBe("github");
  });

  it("returns gitlab from env var when config is null", () => {
    expect(resolveForgeProvider(null, "gitlab", null)).toBe("gitlab");
  });

  it("env var is case-insensitive", () => {
    expect(resolveForgeProvider(null, "GitHub", null)).toBe("github");
    expect(resolveForgeProvider(null, "GITLAB", null)).toBe("gitlab");
  });

  it("env var is trimmed", () => {
    expect(resolveForgeProvider(null, "  github  ", null)).toBe("github");
  });

  it("env var takes precedence over remote URL", () => {
    expect(
      resolveForgeProvider(null, "gitlab", "git@github.com:org/repo.git"),
    ).toBe("gitlab");
  });

  // ── Remote URL auto-detection ──

  it("detects github from remote URL", () => {
    expect(
      resolveForgeProvider(null, undefined, "git@github.com:org/repo.git"),
    ).toBe("github");
  });

  it("detects gitlab from remote URL", () => {
    expect(
      resolveForgeProvider(null, undefined, "git@gitlab.com:group/project.git"),
    ).toBe("gitlab");
  });

  it("detects gitlab from HTTPS remote URL", () => {
    expect(
      resolveForgeProvider(null, undefined, "https://gitlab.com/group/project.git"),
    ).toBe("gitlab");
  });

  // ── Null / unknown ──

  it("returns null when all inputs are empty", () => {
    expect(resolveForgeProvider(null, undefined, null)).toBeNull();
  });

  it("returns null for unrecognized config value", () => {
    expect(resolveForgeProvider("bitbucket", undefined, null)).toBeNull();
  });

  it("returns null for unrecognized env var", () => {
    expect(resolveForgeProvider(null, "bitbucket", null)).toBeNull();
  });

  it("returns null for empty env var", () => {
    expect(resolveForgeProvider(null, "", null)).toBeNull();
  });

  it("returns null for unrecognized remote URL host", () => {
    expect(
      resolveForgeProvider(null, undefined, "git@bitbucket.org:org/repo.git"),
    ).toBeNull();
  });

  // ── Edge cases ──

  it("ignores config value when it's an empty string", () => {
    // Empty string is not "github" or "gitlab", so falls through
    expect(resolveForgeProvider("", undefined, "git@github.com:org/repo.git")).toBe(
      "github",
    );
  });

  it("ignores undefined env var", () => {
    expect(
      resolveForgeProvider(null, undefined, "git@gitlab.com:group/project.git"),
    ).toBe("gitlab");
  });
});
