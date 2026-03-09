import { describe, it, expect } from "vitest";
import { parseGitLabMrList } from "./GitLabForgeCli";
import { parseGitHubPrList } from "./GitHubForgeCli";

describe("parseGitLabMrList", () => {
  it("returns empty array for empty string", () => {
    expect(parseGitLabMrList("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseGitLabMrList("   ")).toEqual([]);
  });

  it("throws for non-array JSON", () => {
    expect(() => parseGitLabMrList('{"iid": 1}')).toThrow("non-array JSON");
  });

  it("parses a single opened MR", () => {
    const input = JSON.stringify([
      {
        iid: 42,
        title: "Add feature",
        web_url: "https://gitlab.com/group/project/-/merge_requests/42",
        source_branch: "feature/add-feature",
        target_branch: "main",
        state: "opened",
        updated_at: "2025-01-15T10:30:00Z",
      },
    ]);

    expect(parseGitLabMrList(input)).toEqual([
      {
        number: 42,
        title: "Add feature",
        url: "https://gitlab.com/group/project/-/merge_requests/42",
        baseBranch: "main",
        headBranch: "feature/add-feature",
        state: "open",
        updatedAt: "2025-01-15T10:30:00Z",
      },
    ]);
  });

  it("normalizes 'opened' state to 'open'", () => {
    const input = JSON.stringify([
      {
        iid: 1,
        title: "MR",
        web_url: "https://gitlab.com/mr/1",
        source_branch: "feat",
        target_branch: "main",
        state: "opened",
      },
    ]);

    expect(parseGitLabMrList(input)[0]!.state).toBe("open");
  });

  it("normalizes 'closed' state", () => {
    const input = JSON.stringify([
      {
        iid: 2,
        title: "MR",
        web_url: "https://gitlab.com/mr/2",
        source_branch: "feat",
        target_branch: "main",
        state: "closed",
      },
    ]);

    expect(parseGitLabMrList(input)[0]!.state).toBe("closed");
  });

  it("normalizes 'locked' state to 'closed'", () => {
    const input = JSON.stringify([
      {
        iid: 3,
        title: "MR",
        web_url: "https://gitlab.com/mr/3",
        source_branch: "feat",
        target_branch: "main",
        state: "locked",
      },
    ]);

    expect(parseGitLabMrList(input)[0]!.state).toBe("closed");
  });

  it("normalizes 'merged' state", () => {
    const input = JSON.stringify([
      {
        iid: 4,
        title: "MR",
        web_url: "https://gitlab.com/mr/4",
        source_branch: "feat",
        target_branch: "main",
        state: "merged",
      },
    ]);

    expect(parseGitLabMrList(input)[0]!.state).toBe("merged");
  });

  it("skips entries with unknown state", () => {
    const input = JSON.stringify([
      {
        iid: 5,
        title: "MR",
        web_url: "https://gitlab.com/mr/5",
        source_branch: "feat",
        target_branch: "main",
        state: "draft",
      },
    ]);

    expect(parseGitLabMrList(input)).toEqual([]);
  });

  it("parses string iid values", () => {
    const input = JSON.stringify([
      {
        iid: "10",
        title: "MR",
        web_url: "https://gitlab.com/mr/10",
        source_branch: "feat",
        target_branch: "main",
        state: "opened",
      },
    ]);

    expect(parseGitLabMrList(input)[0]!.number).toBe(10);
  });

  it("skips entries with invalid iid", () => {
    const input = JSON.stringify([
      {
        iid: -1,
        title: "MR",
        web_url: "https://gitlab.com/mr/-1",
        source_branch: "feat",
        target_branch: "main",
        state: "opened",
      },
    ]);

    expect(parseGitLabMrList(input)).toEqual([]);
  });

  it("skips entries missing required fields", () => {
    const input = JSON.stringify([
      { iid: 1, title: "MR" },
      { iid: 2, title: "MR", web_url: "https://gitlab.com/mr/2" },
    ]);

    expect(parseGitLabMrList(input)).toEqual([]);
  });

  it("sets updatedAt to null when missing", () => {
    const input = JSON.stringify([
      {
        iid: 7,
        title: "MR",
        web_url: "https://gitlab.com/mr/7",
        source_branch: "feat",
        target_branch: "main",
        state: "opened",
      },
    ]);

    expect(parseGitLabMrList(input)[0]!.updatedAt).toBeNull();
  });

  it("parses multiple MRs", () => {
    const input = JSON.stringify([
      {
        iid: 10,
        title: "First MR",
        web_url: "https://gitlab.com/mr/10",
        source_branch: "feat-a",
        target_branch: "main",
        state: "opened",
        updated_at: "2025-01-01T00:00:00Z",
      },
      {
        iid: 11,
        title: "Second MR",
        web_url: "https://gitlab.com/mr/11",
        source_branch: "feat-b",
        target_branch: "develop",
        state: "merged",
        updated_at: "2025-02-01T00:00:00Z",
      },
    ]);

    const result = parseGitLabMrList(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.number).toBe(10);
    expect(result[1]!.number).toBe(11);
  });
});

describe("parseGitHubPrList", () => {
  it("returns empty array for empty string", () => {
    expect(parseGitHubPrList("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseGitHubPrList("   ")).toEqual([]);
  });

  it("throws for non-array JSON", () => {
    expect(() => parseGitHubPrList('{"number": 1}')).toThrow("non-array JSON");
  });

  it("parses a single open PR", () => {
    const input = JSON.stringify([
      {
        number: 99,
        title: "Add feature",
        url: "https://github.com/org/repo/pull/99",
        baseRefName: "main",
        headRefName: "feature/add-feature",
        state: "OPEN",
        updatedAt: "2025-03-10T12:00:00Z",
      },
    ]);

    expect(parseGitHubPrList(input)).toEqual([
      {
        number: 99,
        title: "Add feature",
        url: "https://github.com/org/repo/pull/99",
        baseBranch: "main",
        headBranch: "feature/add-feature",
        state: "open",
        updatedAt: "2025-03-10T12:00:00Z",
      },
    ]);
  });

  it("normalizes 'OPEN' state to 'open'", () => {
    const input = JSON.stringify([
      {
        number: 1,
        title: "PR",
        url: "https://github.com/org/repo/pull/1",
        baseRefName: "main",
        headRefName: "feat",
        state: "OPEN",
      },
    ]);

    expect(parseGitHubPrList(input)[0]!.state).toBe("open");
  });

  it("treats undefined/null state as open", () => {
    const input = JSON.stringify([
      {
        number: 2,
        title: "PR",
        url: "https://github.com/org/repo/pull/2",
        baseRefName: "main",
        headRefName: "feat",
      },
    ]);

    expect(parseGitHubPrList(input)[0]!.state).toBe("open");
  });

  it("normalizes 'CLOSED' state to 'closed'", () => {
    const input = JSON.stringify([
      {
        number: 3,
        title: "PR",
        url: "https://github.com/org/repo/pull/3",
        baseRefName: "main",
        headRefName: "feat",
        state: "CLOSED",
      },
    ]);

    expect(parseGitHubPrList(input)[0]!.state).toBe("closed");
  });

  it("normalizes 'MERGED' state to 'merged'", () => {
    const input = JSON.stringify([
      {
        number: 4,
        title: "PR",
        url: "https://github.com/org/repo/pull/4",
        baseRefName: "main",
        headRefName: "feat",
        state: "MERGED",
      },
    ]);

    expect(parseGitHubPrList(input)[0]!.state).toBe("merged");
  });

  it("treats presence of mergedAt as merged regardless of state", () => {
    const input = JSON.stringify([
      {
        number: 5,
        title: "PR",
        url: "https://github.com/org/repo/pull/5",
        baseRefName: "main",
        headRefName: "feat",
        state: "CLOSED",
        mergedAt: "2025-01-01T00:00:00Z",
      },
    ]);

    expect(parseGitHubPrList(input)[0]!.state).toBe("merged");
  });

  it("skips entries with unknown state", () => {
    const input = JSON.stringify([
      {
        number: 6,
        title: "PR",
        url: "https://github.com/org/repo/pull/6",
        baseRefName: "main",
        headRefName: "feat",
        state: "DRAFT",
      },
    ]);

    expect(parseGitHubPrList(input)).toEqual([]);
  });

  it("skips entries with invalid number", () => {
    const input = JSON.stringify([
      {
        number: -1,
        title: "PR",
        url: "https://github.com/org/repo/pull/-1",
        baseRefName: "main",
        headRefName: "feat",
        state: "OPEN",
      },
    ]);

    expect(parseGitHubPrList(input)).toEqual([]);
  });

  it("skips entries with non-integer number", () => {
    const input = JSON.stringify([
      {
        number: 1.5,
        title: "PR",
        url: "https://github.com/org/repo/pull/1",
        baseRefName: "main",
        headRefName: "feat",
        state: "OPEN",
      },
    ]);

    expect(parseGitHubPrList(input)).toEqual([]);
  });

  it("skips entries missing required fields", () => {
    const input = JSON.stringify([
      { number: 1, title: "PR" },
      { number: 2, title: "PR", url: "https://github.com/org/repo/pull/2" },
    ]);

    expect(parseGitHubPrList(input)).toEqual([]);
  });

  it("sets updatedAt to null when missing", () => {
    const input = JSON.stringify([
      {
        number: 8,
        title: "PR",
        url: "https://github.com/org/repo/pull/8",
        baseRefName: "main",
        headRefName: "feat",
        state: "OPEN",
      },
    ]);

    expect(parseGitHubPrList(input)[0]!.updatedAt).toBeNull();
  });

  it("parses multiple PRs", () => {
    const input = JSON.stringify([
      {
        number: 20,
        title: "First PR",
        url: "https://github.com/org/repo/pull/20",
        baseRefName: "main",
        headRefName: "feat-a",
        state: "OPEN",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      {
        number: 21,
        title: "Second PR",
        url: "https://github.com/org/repo/pull/21",
        baseRefName: "main",
        headRefName: "feat-b",
        state: "MERGED",
        mergedAt: "2025-02-01T00:00:00Z",
        updatedAt: "2025-02-01T00:00:00Z",
      },
    ]);

    const result = parseGitHubPrList(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.number).toBe(20);
    expect(result[0]!.state).toBe("open");
    expect(result[1]!.number).toBe(21);
    expect(result[1]!.state).toBe("merged");
  });
});
