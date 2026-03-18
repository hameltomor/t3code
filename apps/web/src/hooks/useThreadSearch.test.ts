import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId } from "@xbetools/contracts";
import { getProjectThreadsForSearch } from "./useThreadSearch";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "../types";

function makeThread(overrides: Partial<Thread> & { id: ThreadId }): Thread {
  return {
    codexThreadId: null,
    providerThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    contextStatus: null,
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    worktreeEntries: [],
    ...overrides,
  };
}

describe("getProjectThreadsForSearch", () => {
  const projectId = ProjectId.makeUnsafe("project-1");

  it("sorts threads by updatedAt descending", () => {
    const threads: Thread[] = [
      makeThread({
        id: ThreadId.makeUnsafe("old-created-recent-activity"),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("new-created-no-activity"),
        createdAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:00.000Z",
      }),
    ];

    const result = getProjectThreadsForSearch(threads, projectId, null);

    expect(result[0]!.id).toBe("old-created-recent-activity");
    expect(result[1]!.id).toBe("new-created-no-activity");
  });

  it("filters by project and search set", () => {
    const threads: Thread[] = [
      makeThread({ id: ThreadId.makeUnsafe("t1"), updatedAt: "2026-03-10T00:00:00.000Z" }),
      makeThread({ id: ThreadId.makeUnsafe("t2"), updatedAt: "2026-03-05T00:00:00.000Z" }),
      makeThread({
        id: ThreadId.makeUnsafe("t3"),
        projectId: ProjectId.makeUnsafe("other"),
        updatedAt: "2026-03-15T00:00:00.000Z",
      }),
    ];

    const filtered = new Set(["t1"]);
    const result = getProjectThreadsForSearch(threads, projectId, filtered);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("t1");
  });

  it("returns all project threads when no search filter is active", () => {
    const threads: Thread[] = [
      makeThread({ id: ThreadId.makeUnsafe("t1"), updatedAt: "2026-03-10T00:00:00.000Z" }),
      makeThread({ id: ThreadId.makeUnsafe("t2"), updatedAt: "2026-03-12T00:00:00.000Z" }),
    ];

    const result = getProjectThreadsForSearch(threads, projectId, null);

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("t2");
    expect(result[1]!.id).toBe("t1");
  });
});
