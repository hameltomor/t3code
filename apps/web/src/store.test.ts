import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@xbetools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyProjectOrder,
  markThreadUnread,
  promoteDraftThread,
  reorderProjects,
  syncServerReadModel,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
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
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    worktreeEntries: [],
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        model: "gpt-5-codex",
        expanded: true,
        scripts: [],
        workspaceMembers: [],
      },
    ],
    threads: [thread],
    threadsHydrated: true,
    selectedRepoCwdByProject: {},
    projectOrder: [],
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    worktreeEntries: [],
    providerThreadId: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    contextStatus: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5.3-codex",
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
        workspaceMembers: [],
      },
    ],
    threads: [thread],
  };
}

describe("store pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });
});

describe("promoteDraftThread", () => {
  it("inserts placeholder thread so route guard sees it after draft is cleared", () => {
    const emptyState: AppState = {
      projects: [],
      threads: [],
      threadsHydrated: true,
      selectedRepoCwdByProject: {},
      projectOrder: [],
    };
    const draftThread = makeThread({
      id: ThreadId.makeUnsafe("new-draft"),
      title: "First message title",
    });

    const afterPromotion = promoteDraftThread(emptyState, draftThread);

    // Thread must be present so `useThreadExists` returns true and
    // the route guard at _chat.$threadId.tsx#L185 does not redirect to /.
    expect(afterPromotion.threads).toHaveLength(1);
    expect(afterPromotion.threads[0]?.id).toBe("new-draft");
    expect(afterPromotion.threads[0]?.title).toBe("First message title");
  });

  it("is a no-op when the server sync already added the thread", () => {
    const existingThread = makeThread({ id: ThreadId.makeUnsafe("existing") });
    const state = makeState(existingThread);

    const next = promoteDraftThread(state, makeThread({ id: ThreadId.makeUnsafe("existing") }));

    expect(next).toBe(state);
  });

  it("preserves worktreeEntries for multi-repo workspaces", () => {
    const emptyState: AppState = {
      projects: [],
      threads: [],
      threadsHydrated: true,
      selectedRepoCwdByProject: {},
      projectOrder: [],
    };
    const entries = [
      { name: "repo-a", relativePath: "./repo-a", originalPath: "/repo-a", worktreePath: "/wt/repo-a", branch: "feature" },
      { name: "repo-b", relativePath: "./repo-b", originalPath: "/repo-b", worktreePath: "/wt/repo-b", branch: "feature" },
    ];
    const draftThread = makeThread({
      id: ThreadId.makeUnsafe("multi-repo"),
      worktreeEntries: entries,
    });

    const next = promoteDraftThread(emptyState, draftThread);

    expect(next.threads[0]?.worktreeEntries).toEqual(entries);
  });

  it("placeholder is overwritten by subsequent server snapshot sync", () => {
    const emptyState: AppState = {
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project",
          cwd: "/tmp/project",
          model: "gpt-5-codex",
          expanded: true,
          scripts: [],
          workspaceMembers: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
      selectedRepoCwdByProject: {},
      projectOrder: [],
    };
    const placeholder = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      title: "Placeholder",
    });

    const afterPromotion = promoteDraftThread(emptyState, placeholder);
    expect(afterPromotion.threads[0]?.title).toBe("Placeholder");

    const readModel = makeReadModel(
      makeReadModelThread({
        id: ThreadId.makeUnsafe("thread-1"),
        title: "Server title",
      }),
    );
    const afterSync = syncServerReadModel(afterPromotion, readModel);

    expect(afterSync.threads).toHaveLength(1);
    expect(afterSync.threads[0]?.title).toBe("Server title");
  });
});

describe("store read model sync", () => {
  it("infers claudeCode provider and preserves model for claude models without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "claude-opus-4-6",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe("claude-opus-4-6");
  });

  it("maps thread updatedAt from the server read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-03-10T12:00:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.updatedAt).toBe("2026-03-10T12:00:00.000Z");
    expect(next.threads[0]?.createdAt).toBe("2026-02-27T00:00:00.000Z");
  });

  it("falls back to the codex default for unknown models without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "some-unknown-model",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });
});

describe("project ordering", () => {
  const makeProject = (id: string, cwd: string, name = id) => ({
    id: ProjectId.makeUnsafe(id),
    name,
    cwd,
    model: "gpt-5-codex",
    expanded: true,
    scripts: [],
    workspaceMembers: [],
  });

  it("applies a saved manual order and appends unknown projects at the end", () => {
    const projects = [
      makeProject("project-a", "/tmp/project-a", "Project A"),
      makeProject("project-b", "/tmp/project-b", "Project B"),
      makeProject("project-c", "/tmp/project-c", "Project C"),
    ];

    const ordered = applyProjectOrder(projects, ["/tmp/project-c", "/tmp/project-a"]);

    expect(ordered.map((project) => project.cwd)).toEqual([
      "/tmp/project-c",
      "/tmp/project-a",
      "/tmp/project-b",
    ]);
  });

  it("reorders projects by index and stores the resulting cwd order", () => {
    const state: AppState = {
      projects: [
        makeProject("project-a", "/tmp/project-a", "Project A"),
        makeProject("project-b", "/tmp/project-b", "Project B"),
        makeProject("project-c", "/tmp/project-c", "Project C"),
      ],
      threads: [],
      threadsHydrated: true,
      selectedRepoCwdByProject: {},
      projectOrder: ["/tmp/project-a", "/tmp/project-b", "/tmp/project-c"],
    };

    const next = reorderProjects(state, 0, 2);

    expect(next.projectOrder).toEqual([
      "/tmp/project-b",
      "/tmp/project-c",
      "/tmp/project-a",
    ]);
  });

  it("treats same-index reorder as a no-op", () => {
    const state: AppState = {
      projects: [
        makeProject("project-a", "/tmp/project-a", "Project A"),
        makeProject("project-b", "/tmp/project-b", "Project B"),
      ],
      threads: [],
      threadsHydrated: true,
      selectedRepoCwdByProject: {},
      projectOrder: ["/tmp/project-a", "/tmp/project-b"],
    };

    const next = reorderProjects(state, 1, 1);

    expect(next).toBe(state);
  });
});
