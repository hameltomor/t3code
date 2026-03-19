import { useCallback } from "react";
import type { ThreadId } from "@xbetools/contracts";
import { create } from "zustand";
import type { QueuedMessage, ChatAttachment } from "./types";

// ── Persistence ──────────────────────────────────────────────────────

const STORAGE_KEY = "xbecode:message-queue:v1";

interface PersistedQueueEntry {
  id: string;
  messageId: string;
  text: string;
  queuedAt: string;
}

function readPersistedQueue(): Map<string, QueuedMessage[]> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, PersistedQueueEntry[]>;
    const map = new Map<string, QueuedMessage[]>();
    for (const [threadId, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) continue;
      map.set(
        threadId,
        entries.map((e) => ({
          id: e.id,
          messageId: e.messageId as QueuedMessage["messageId"],
          text: e.text,
          attachments: [], // attachments are not serializable, text-only on restore
          queuedAt: e.queuedAt,
        })),
      );
    }
    return map;
  } catch {
    return new Map();
  }
}

function persistQueue(queue: Map<string, QueuedMessage[]>): void {
  if (typeof window === "undefined") return;
  try {
    const serializable: Record<string, PersistedQueueEntry[]> = {};
    for (const [threadId, messages] of queue) {
      if (messages.length === 0) continue;
      serializable[threadId] = messages.map((m) => ({
        id: m.id,
        messageId: m.messageId,
        text: m.text,
        queuedAt: m.queuedAt,
      }));
    }
    if (Object.keys(serializable).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    }
  } catch {
    // Ignore quota/storage errors
  }
}

// ── Store ────────────────────────────────────────────────────────────

interface MessageQueueState {
  /** Per-thread message queues */
  queue: Map<string, QueuedMessage[]>;
  /** Monotonically increasing version counter — lets React effects react to queue changes */
  version: number;
}

interface MessageQueueActions {
  enqueueMessage: (
    threadId: ThreadId,
    message: { id: string; messageId: QueuedMessage["messageId"]; text: string; attachments: ChatAttachment[] },
  ) => void;
  dequeueMessage: (threadId: ThreadId) => QueuedMessage | undefined;
  removeQueuedMessage: (threadId: ThreadId, messageId: string) => void;
  updateQueuedMessage: (threadId: ThreadId, messageId: string, newText: string) => void;
  promoteQueuedMessage: (threadId: ThreadId, messageId: string) => void;
  clearQueue: (threadId: ThreadId) => void;
}

interface MessageQueueStore extends MessageQueueState, MessageQueueActions {}

/** Stable empty array — avoids creating a new [] on every selector call (which would break Zustand's Object.is equality check). */
const EMPTY_QUEUE: QueuedMessage[] = [];

function getThreadQueue(queue: Map<string, QueuedMessage[]>, threadId: string): QueuedMessage[] {
  return queue.get(threadId) ?? EMPTY_QUEUE;
}

export const useMessageQueueStore = create<MessageQueueStore>((set, get) => ({
  queue: readPersistedQueue(),
  version: 0,

  enqueueMessage: (threadId, message) =>
    set((state) => {
      const threadQueue = getThreadQueue(state.queue, threadId);
      const newQueue = new Map(state.queue);
      newQueue.set(threadId, [
        ...threadQueue,
        {
          id: message.id,
          messageId: message.messageId,
          text: message.text,
          attachments: message.attachments,
          queuedAt: new Date().toISOString(),
        },
      ]);
      persistQueue(newQueue);
      return { queue: newQueue, version: state.version + 1 };
    }),

  dequeueMessage: (threadId) => {
    const state = get();
    const threadQueue = getThreadQueue(state.queue, threadId);
    if (threadQueue.length === 0) return undefined;
    const [first, ...rest] = threadQueue;
    const newQueue = new Map(state.queue);
    if (rest.length === 0) {
      newQueue.delete(threadId);
    } else {
      newQueue.set(threadId, rest);
    }
    set({ queue: newQueue, version: state.version + 1 });
    persistQueue(newQueue);
    return first;
  },

  removeQueuedMessage: (threadId, messageId) =>
    set((state) => {
      const threadQueue = getThreadQueue(state.queue, threadId);
      const filtered = threadQueue.filter((m) => m.id !== messageId);
      if (filtered.length === threadQueue.length) return state;
      const newQueue = new Map(state.queue);
      if (filtered.length === 0) {
        newQueue.delete(threadId);
      } else {
        newQueue.set(threadId, filtered);
      }
      persistQueue(newQueue);
      return { queue: newQueue, version: state.version + 1 };
    }),

  updateQueuedMessage: (threadId, messageId, newText) =>
    set((state) => {
      const threadQueue = getThreadQueue(state.queue, threadId);
      let changed = false;
      const updated = threadQueue.map((m) => {
        if (m.id !== messageId) return m;
        changed = true;
        return { ...m, text: newText };
      });
      if (!changed) return state;
      const newQueue = new Map(state.queue);
      newQueue.set(threadId, updated);
      persistQueue(newQueue);
      return { queue: newQueue, version: state.version + 1 };
    }),

  promoteQueuedMessage: (threadId, messageId) =>
    set((state) => {
      const threadQueue = getThreadQueue(state.queue, threadId);
      const idx = threadQueue.findIndex((m) => m.id === messageId);
      if (idx < 0) return state;
      // Move the promoted message to the front of the queue
      const promoted = threadQueue[idx]!;
      const rest = [...threadQueue.slice(0, idx), ...threadQueue.slice(idx + 1)];
      const newQueue = new Map(state.queue);
      newQueue.set(threadId, [promoted, ...rest]);
      persistQueue(newQueue);
      return { queue: newQueue, version: state.version + 1 };
    }),

  clearQueue: (threadId) =>
    set((state) => {
      if (!state.queue.has(threadId)) return state;
      const newQueue = new Map(state.queue);
      newQueue.delete(threadId);
      persistQueue(newQueue);
      return { queue: newQueue, version: state.version + 1 };
    }),
}));

// ── Selector hooks ──────────────────────────────────────────────────

/** Get the queue for a specific thread. */
export function useThreadQueue(threadId: ThreadId | null | undefined): QueuedMessage[] {
  return useMessageQueueStore(
    useCallback(
      (store: MessageQueueStore) =>
        threadId ? getThreadQueue(store.queue, threadId) : EMPTY_QUEUE,
      [threadId],
    ),
  );
}

/** Get the queue length for a specific thread. */
export function useThreadQueueLength(threadId: ThreadId | null | undefined): number {
  return useMessageQueueStore(
    useCallback(
      (store: MessageQueueStore) =>
        threadId ? getThreadQueue(store.queue, threadId).length : 0,
      [threadId],
    ),
  );
}

/** Get the version counter for reactivity in effects. */
export function useQueueVersion(): number {
  return useMessageQueueStore((store) => store.version);
}
