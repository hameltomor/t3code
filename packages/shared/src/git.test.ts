import { describe, it, expect } from "vitest";
import { detectForgeProviderFromRemoteUrl, extractHostFromRemoteUrl } from "./git";

describe("extractHostFromRemoteUrl", () => {
  it("extracts host from SSH format", () => {
    expect(extractHostFromRemoteUrl("git@github.com:org/repo.git")).toBe("github.com");
  });

  it("extracts host from HTTPS format", () => {
    expect(extractHostFromRemoteUrl("https://github.com/org/repo.git")).toBe("github.com");
  });

  it("extracts host from SSH format with gitlab enterprise domain", () => {
    expect(extractHostFromRemoteUrl("git@gitlab.company.com:group/repo.git")).toBe(
      "gitlab.company.com",
    );
  });

  it("extracts host from HTTPS format with gitlab enterprise domain", () => {
    expect(extractHostFromRemoteUrl("https://gitlab.company.com/group/repo.git")).toBe(
      "gitlab.company.com",
    );
  });

  it("returns null for empty string", () => {
    expect(extractHostFromRemoteUrl("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(extractHostFromRemoteUrl("   ")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(extractHostFromRemoteUrl("not-a-url")).toBeNull();
  });

  it("lowercases the host", () => {
    expect(extractHostFromRemoteUrl("https://GitHub.COM/org/repo.git")).toBe("github.com");
  });

  it("lowercases SSH host", () => {
    expect(extractHostFromRemoteUrl("git@GitHub.COM:org/repo.git")).toBe("github.com");
  });
});

describe("detectForgeProviderFromRemoteUrl", () => {
  it("detects github from SSH remote", () => {
    expect(detectForgeProviderFromRemoteUrl("git@github.com:org/repo.git")).toBe("github");
  });

  it("detects github from HTTPS remote", () => {
    expect(detectForgeProviderFromRemoteUrl("https://github.com/org/repo.git")).toBe("github");
  });

  it("detects gitlab from SSH remote", () => {
    expect(detectForgeProviderFromRemoteUrl("git@gitlab.com:group/repo.git")).toBe("gitlab");
  });

  it("detects gitlab from HTTPS remote", () => {
    expect(detectForgeProviderFromRemoteUrl("https://gitlab.com/group/repo.git")).toBe("gitlab");
  });

  it("detects gitlab from enterprise SSH remote when host contains gitlab", () => {
    expect(detectForgeProviderFromRemoteUrl("git@gitlab.company.com:group/repo.git")).toBe(
      "gitlab",
    );
  });

  it("returns null for unknown host", () => {
    expect(detectForgeProviderFromRemoteUrl("https://code.company.com/group/repo.git")).toBeNull();
  });

  it("returns null for unsupported provider", () => {
    expect(detectForgeProviderFromRemoteUrl("git@bitbucket.org:team/repo.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectForgeProviderFromRemoteUrl("")).toBeNull();
  });
});
