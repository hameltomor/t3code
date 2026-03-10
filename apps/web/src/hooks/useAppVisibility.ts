import { useSyncExternalStore } from "react";

export type AppVisibility = "active" | "passive" | "hidden";

// ---------------------------------------------------------------------------
// Core state
// ---------------------------------------------------------------------------

let listeners: Array<() => void> = [];
let activeListeners: Array<() => void> = [];
let lastVisibility: AppVisibility | null = null;

function emitChange(): void {
  const prev = lastVisibility;
  // Reset cached snapshot so getSnapshot recomputes
  lastVisibility = null;
  const next = getAppVisibility();

  // Fire "became active" callbacks on transition TO active
  if (prev !== null && prev !== "active" && next === "active") {
    for (const cb of activeListeners) cb();
  }

  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** Non-reactive snapshot — safe to call from event handlers and callbacks. */
export function getAppVisibility(): AppVisibility {
  if (typeof document === "undefined") return "active";

  if (document.visibilityState === "hidden") return "hidden";
  if (!document.hasFocus()) return "passive";
  return "active";
}

function getSnapshot(): AppVisibility {
  if (lastVisibility === null) {
    lastVisibility = getAppVisibility();
  }
  return lastVisibility;
}

// ---------------------------------------------------------------------------
// Subscription (shared across all hook consumers)
// ---------------------------------------------------------------------------

function subscribe(listener: () => void): () => void {
  const needsSetup = listeners.length === 0;
  listeners.push(listener);

  if (needsSetup) {
    document.addEventListener("visibilitychange", emitChange);
    window.addEventListener("focus", emitChange);
    window.addEventListener("blur", emitChange);
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    if (listeners.length === 0) {
      document.removeEventListener("visibilitychange", emitChange);
      window.removeEventListener("focus", emitChange);
      window.removeEventListener("blur", emitChange);
    }
  };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/** Reactive hook — re-renders when app visibility changes. */
export function useAppVisibility(): AppVisibility {
  return useSyncExternalStore(subscribe, getSnapshot, () => "active" as const);
}

// ---------------------------------------------------------------------------
// "Became active" callback (for non-React cleanup logic)
// ---------------------------------------------------------------------------

/**
 * Register a callback that fires when the app transitions TO "active"
 * (i.e. tab becomes visible AND focused). Returns an unsubscribe function.
 *
 * Also sets up the global event listeners if this is the first subscriber
 * (so it works even without the React hook mounted).
 */
export function onAppBecameActive(callback: () => void): () => void {
  activeListeners.push(callback);

  // Ensure global listeners are installed even without React hook subscribers
  let teardownGlobal: (() => void) | null = null;
  if (listeners.length === 0) {
    // Use a no-op subscriber to keep global listeners alive
    teardownGlobal = subscribe(() => {});
  }

  return () => {
    activeListeners = activeListeners.filter((cb) => cb !== callback);
    teardownGlobal?.();
  };
}
