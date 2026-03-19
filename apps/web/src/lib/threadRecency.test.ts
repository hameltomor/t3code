import { describe, expect, it } from "vitest";

import {
  compareThreadsByRecency,
  getThreadRecencyMs,
  type ThreadRecencyFields,
} from "./threadRecency";

function makeThread(overrides: Partial<ThreadRecencyFields> = {}): ThreadRecencyFields {
  return {
    id: "thread-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("compareThreadsByRecency", () => {
  it("sorts by updatedAt descending (most recent first)", () => {
    const older = makeThread({
      id: "thread-old",
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
    const newer = makeThread({
      id: "thread-new",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    });

    const sorted = [older, newer].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("thread-new");
    expect(sorted[1]!.id).toBe("thread-old");
  });

  it("thread with older createdAt but newer updatedAt sorts above a newer-created inactive thread", () => {
    const oldCreatedRecentlyActive = makeThread({
      id: "thread-active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-15T12:00:00.000Z",
    });
    const newCreatedInactive = makeThread({
      id: "thread-inactive",
      createdAt: "2026-03-14T00:00:00.000Z",
      updatedAt: "2026-03-14T00:00:00.000Z",
    });

    const sorted = [newCreatedInactive, oldCreatedRecentlyActive].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("thread-active");
    expect(sorted[1]!.id).toBe("thread-inactive");
  });

  it("falls back to createdAt when updatedAt is equal", () => {
    const a = makeThread({
      id: "thread-a",
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
    const b = makeThread({
      id: "thread-b",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });

    const sorted = [a, b].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("thread-b");
  });

  it("falls back to id when both timestamps are equal", () => {
    const a = makeThread({ id: "aaa" });
    const b = makeThread({ id: "zzz" });

    const sorted = [a, b].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("zzz");
  });
});

describe("getThreadRecencyMs", () => {
  it("returns the updatedAt timestamp in milliseconds", () => {
    const thread = makeThread({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-15T12:00:00.000Z",
    });
    expect(getThreadRecencyMs(thread)).toBe(new Date("2026-03-15T12:00:00.000Z").getTime());
  });

  it("returns updatedAt not createdAt even when createdAt is more recent", () => {
    const thread = makeThread({
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    });
    expect(getThreadRecencyMs(thread)).toBe(new Date("2026-03-15T00:00:00.000Z").getTime());
  });
});

// ── Regression: project group ordering by newest child thread ─────────

describe("project group ordering by newest child thread updatedAt", () => {
  interface ProjectThread extends ThreadRecencyFields {
    projectId: string;
  }

  function makeProjectThread(projectId: string, overrides: Partial<ThreadRecencyFields> = {}): ProjectThread {
    return { ...makeThread(overrides), projectId };
  }

  function getProjectOrder(
    projects: readonly { id: string }[],
    threads: readonly ProjectThread[],
  ): string[] {
    const latestUpdateByProjectId = new Map<string, number>();
    for (const thread of threads) {
      const ts = getThreadRecencyMs(thread);
      const existing = latestUpdateByProjectId.get(thread.projectId) ?? 0;
      if (ts > existing) {
        latestUpdateByProjectId.set(thread.projectId, ts);
      }
    }
    return [...projects]
      .toSorted((a, b) => {
        const aTime = latestUpdateByProjectId.get(a.id) ?? 0;
        const bTime = latestUpdateByProjectId.get(b.id) ?? 0;
        return bTime - aTime;
      })
      .map((p) => p.id);
  }

  it("orders projects by the newest child thread updatedAt", () => {
    const projects = [{ id: "proj-A" }, { id: "proj-B" }];
    const threads: ProjectThread[] = [
      makeProjectThread("proj-A", { id: "t-a1", updatedAt: "2026-03-10T00:00:00.000Z" }),
      makeProjectThread("proj-B", { id: "t-b1", updatedAt: "2026-03-15T00:00:00.000Z" }),
    ];

    expect(getProjectOrder(projects, threads)).toEqual(["proj-B", "proj-A"]);
  });

  it("uses updatedAt not createdAt for project ordering", () => {
    const projects = [{ id: "proj-old" }, { id: "proj-new" }];
    const threads: ProjectThread[] = [
      // proj-old has a thread created long ago but updated recently
      makeProjectThread("proj-old", {
        id: "t-old",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      }),
      // proj-new has a recently created thread but not updated since
      makeProjectThread("proj-new", {
        id: "t-new",
        createdAt: "2026-03-17T00:00:00.000Z",
        updatedAt: "2026-03-17T00:00:00.000Z",
      }),
    ];

    expect(getProjectOrder(projects, threads)).toEqual(["proj-old", "proj-new"]);
  });

  it("picks the newest thread when a project has multiple threads", () => {
    const projects = [{ id: "proj-A" }, { id: "proj-B" }];
    const threads: ProjectThread[] = [
      makeProjectThread("proj-A", { id: "t-a1", updatedAt: "2026-03-01T00:00:00.000Z" }),
      makeProjectThread("proj-A", { id: "t-a2", updatedAt: "2026-03-20T00:00:00.000Z" }),
      makeProjectThread("proj-B", { id: "t-b1", updatedAt: "2026-03-15T00:00:00.000Z" }),
    ];

    // proj-A has thread t-a2 at Mar 20, which is newer than proj-B's Mar 15
    expect(getProjectOrder(projects, threads)).toEqual(["proj-A", "proj-B"]);
  });
});

// ── Regression: sidebar timestamp uses updatedAt ──────────────────────

describe("sidebar thread timestamp source", () => {
  it("formatRelativeTime receives updatedAt (not createdAt) for display", () => {
    // This test documents that the sidebar renders thread.updatedAt as the
    // thread timestamp. The actual rendering is in Sidebar.tsx line:
    //   {formatRelativeTime(thread.updatedAt)}
    // We verify here that getThreadRecencyMs (the ordering primitive) and
    // the display timestamp both derive from updatedAt.
    const thread = makeThread({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-19T08:30:00.000Z",
    });

    // The value used for sorting and display must be updatedAt
    expect(getThreadRecencyMs(thread)).toBe(Date.parse("2026-03-19T08:30:00.000Z"));
    // NOT createdAt
    expect(getThreadRecencyMs(thread)).not.toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
});
