import type { MessageId, ProjectId, ThreadId } from "@xbetools/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage, Project, Thread } from "./types";
import {
  navigateComposerPromptHistory,
  resolveComposerPromptHistoryEntries,
  type ComposerPromptHistoryNavigationState,
} from "./composerPromptHistory";

// ── Helpers ──────────────────────────────────────────────────────────

let messageIdCounter = 0;

function makeUserMessage(text: string, createdAt = "2025-01-01T00:00:00Z"): ChatMessage {
  messageIdCounter += 1;
  return {
    id: `msg-${messageIdCounter}` as MessageId,
    role: "user",
    text,
    createdAt,
    streaming: false,
  };
}

function makeAssistantMessage(text: string): ChatMessage {
  messageIdCounter += 1;
  return {
    id: `msg-${messageIdCounter}` as MessageId,
    role: "assistant",
    text,
    createdAt: "2025-01-01T00:00:00Z",
    streaming: false,
  };
}

function makeProject(id: string, cwd: string): Project {
  return {
    id: id as ProjectId,
    name: id,
    cwd,
    model: "gpt-4.1",
    expanded: false,
    scripts: [],
    workspaceMembers: [],
  };
}

function makeThread(
  id: string,
  projectId: string,
  messages: ChatMessage[],
  createdAt = "2025-01-01T00:00:00Z",
): Thread {
  return {
    id: id as ThreadId,
    codexThreadId: null,
    providerThreadId: null,
    projectId: projectId as ProjectId,
    title: id,
    model: "gpt-4.1",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages,
    proposedPlans: [],
    error: null,
    createdAt,
    updatedAt: createdAt,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    worktreeEntries: [],
    turnDiffSummaries: [],
    activities: [],
    contextStatus: null,
  };
}

// ── resolveComposerPromptHistoryEntries ──────────────────────────────

describe("resolveComposerPromptHistoryEntries", () => {
  it("returns current thread messages newest-first when available", () => {
    const messages = [
      makeUserMessage("first"),
      makeAssistantMessage("reply"),
      makeUserMessage("second"),
      makeUserMessage("third"),
    ];
    const entries = resolveComposerPromptHistoryEntries({
      currentProjectId: "proj-1" as ProjectId,
      currentThreadMessages: messages,
      projects: [],
      threads: [],
    });
    expect(entries).toEqual(["third", "second", "first"]);
  });

  it("excludes assistant messages from history", () => {
    const messages = [
      makeUserMessage("hello"),
      makeAssistantMessage("world"),
    ];
    const entries = resolveComposerPromptHistoryEntries({
      currentProjectId: "proj-1" as ProjectId,
      currentThreadMessages: messages,
      projects: [],
      threads: [],
    });
    expect(entries).toEqual(["hello"]);
  });

  it("respects ignoredMessageTexts", () => {
    const messages = [
      makeUserMessage("keep"),
      makeUserMessage("[image only]"),
    ];
    const entries = resolveComposerPromptHistoryEntries({
      currentProjectId: "proj-1" as ProjectId,
      currentThreadMessages: messages,
      projects: [],
      threads: [],
      ignoredMessageTexts: ["[image only]"],
    });
    expect(entries).toEqual(["keep"]);
  });

  it("falls back to same-project threads when current thread has no user messages", () => {
    const project = makeProject("proj-1", "/workspace");
    const thread1 = makeThread("t-1", "proj-1", [
      makeUserMessage("from-thread-1", "2025-01-02T00:00:00Z"),
    ], "2025-01-02T00:00:00Z");
    const thread2 = makeThread("t-2", "proj-1", [
      makeUserMessage("from-thread-2", "2025-01-01T00:00:00Z"),
    ], "2025-01-01T00:00:00Z");

    const entries = resolveComposerPromptHistoryEntries({
      currentProjectId: "proj-1" as ProjectId,
      currentThreadMessages: [],
      projects: [project],
      threads: [thread1, thread2],
    });
    expect(entries).toEqual(["from-thread-1", "from-thread-2"]);
  });

  it("excludes threads from different project CWDs in fallback", () => {
    const project1 = makeProject("proj-1", "/workspace/a");
    const project2 = makeProject("proj-2", "/workspace/b");
    const thread1 = makeThread("t-1", "proj-1", [makeUserMessage("a-msg")]);
    const thread2 = makeThread("t-2", "proj-2", [makeUserMessage("b-msg")]);

    const entries = resolveComposerPromptHistoryEntries({
      currentProjectId: "proj-1" as ProjectId,
      currentThreadMessages: [],
      projects: [project1, project2],
      threads: [thread1, thread2],
    });
    expect(entries).toEqual(["a-msg"]);
  });

  it("returns empty when no project matches", () => {
    const entries = resolveComposerPromptHistoryEntries({
      currentProjectId: "nonexistent" as ProjectId,
      currentThreadMessages: [],
      projects: [],
      threads: [],
    });
    expect(entries).toEqual([]);
  });
});

// ── navigateComposerPromptHistory ────────────────────────────────────

describe("navigateComposerPromptHistory", () => {
  const entries = ["newest", "middle", "oldest"];

  it("returns not handled when entries are empty", () => {
    const result = navigateComposerPromptHistory({
      currentPrompt: "draft",
      direction: "up",
      entries: [],
      navigationState: null,
    });
    expect(result.handled).toBe(false);
    expect(result.nextPrompt).toBe("draft");
    expect(result.nextNavigationState).toBeNull();
  });

  it("captures draft and shows newest entry on first ArrowUp", () => {
    const result = navigateComposerPromptHistory({
      currentPrompt: "my draft",
      direction: "up",
      entries,
      navigationState: null,
    });
    expect(result.handled).toBe(true);
    expect(result.nextPrompt).toBe("newest");
    expect(result.nextNavigationState).toEqual({
      draftPrompt: "my draft",
      historyIndex: 0,
    });
  });

  it("walks deeper into history on subsequent ArrowUp", () => {
    const state: ComposerPromptHistoryNavigationState = {
      draftPrompt: "my draft",
      historyIndex: 0,
    };
    const result = navigateComposerPromptHistory({
      currentPrompt: "newest",
      direction: "up",
      entries,
      navigationState: state,
    });
    expect(result.handled).toBe(true);
    expect(result.nextPrompt).toBe("middle");
    expect(result.nextNavigationState?.historyIndex).toBe(1);
  });

  it("clamps at the oldest entry and stays handled", () => {
    const state: ComposerPromptHistoryNavigationState = {
      draftPrompt: "my draft",
      historyIndex: 2,
    };
    const result = navigateComposerPromptHistory({
      currentPrompt: "oldest",
      direction: "up",
      entries,
      navigationState: state,
    });
    expect(result.handled).toBe(true);
    expect(result.nextPrompt).toBe("oldest");
    expect(result.nextNavigationState).toEqual(state);
  });

  it("restores draft on ArrowDown past index 0", () => {
    const state: ComposerPromptHistoryNavigationState = {
      draftPrompt: "my draft",
      historyIndex: 0,
    };
    const result = navigateComposerPromptHistory({
      currentPrompt: "newest",
      direction: "down",
      entries,
      navigationState: state,
    });
    expect(result.handled).toBe(true);
    expect(result.nextPrompt).toBe("my draft");
    expect(result.nextNavigationState).toBeNull();
  });

  it("walks back toward newest on ArrowDown from deeper history", () => {
    const state: ComposerPromptHistoryNavigationState = {
      draftPrompt: "my draft",
      historyIndex: 2,
    };
    const result = navigateComposerPromptHistory({
      currentPrompt: "oldest",
      direction: "down",
      entries,
      navigationState: state,
    });
    expect(result.handled).toBe(true);
    expect(result.nextPrompt).toBe("middle");
    expect(result.nextNavigationState?.historyIndex).toBe(1);
  });

  it("does nothing on ArrowDown without active navigation", () => {
    const result = navigateComposerPromptHistory({
      currentPrompt: "draft",
      direction: "down",
      entries,
      navigationState: null,
    });
    expect(result.handled).toBe(false);
    expect(result.nextPrompt).toBe("draft");
    expect(result.nextNavigationState).toBeNull();
  });

  it("clamps at oldest entry without changing navigation state", () => {
    const state: ComposerPromptHistoryNavigationState = {
      draftPrompt: "my draft",
      historyIndex: 2,
    };
    const result = navigateComposerPromptHistory({
      currentPrompt: "oldest",
      direction: "up",
      entries,
      navigationState: state,
    });
    expect(result.handled).toBe(true);
    expect(result.nextPrompt).toBe("oldest");
    // Navigation state must be unchanged — no index shift
    expect(result.nextNavigationState).toBe(state);
  });

  it("clamp then ArrowDown still walks back normally", () => {
    // Clamp at oldest
    const clamped = navigateComposerPromptHistory({
      currentPrompt: "oldest",
      direction: "up",
      entries,
      navigationState: { draftPrompt: "my draft", historyIndex: 2 },
    });
    expect(clamped.handled).toBe(true);
    expect(clamped.nextNavigationState?.historyIndex).toBe(2);

    // ArrowDown should walk back toward newest
    const result = navigateComposerPromptHistory({
      currentPrompt: clamped.nextPrompt,
      direction: "down",
      entries,
      navigationState: clamped.nextNavigationState,
    });
    expect(result.handled).toBe(true);
    expect(result.nextPrompt).toBe("middle");
    expect(result.nextNavigationState?.historyIndex).toBe(1);
  });

  it("preserves draft across full up-then-down cycle", () => {
    // ArrowUp from clean state
    let result = navigateComposerPromptHistory({
      currentPrompt: "original draft",
      direction: "up",
      entries,
      navigationState: null,
    });
    expect(result.nextPrompt).toBe("newest");

    // ArrowUp again
    result = navigateComposerPromptHistory({
      currentPrompt: result.nextPrompt,
      direction: "up",
      entries,
      navigationState: result.nextNavigationState,
    });
    expect(result.nextPrompt).toBe("middle");

    // ArrowDown
    result = navigateComposerPromptHistory({
      currentPrompt: result.nextPrompt,
      direction: "down",
      entries,
      navigationState: result.nextNavigationState,
    });
    expect(result.nextPrompt).toBe("newest");

    // ArrowDown again — restores draft
    result = navigateComposerPromptHistory({
      currentPrompt: result.nextPrompt,
      direction: "down",
      entries,
      navigationState: result.nextNavigationState,
    });
    expect(result.nextPrompt).toBe("original draft");
    expect(result.nextNavigationState).toBeNull();
  });
});
