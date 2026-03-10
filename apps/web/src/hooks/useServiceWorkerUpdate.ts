import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron } from "../env";

/** Interval between periodic SW update checks (4 hours). */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface ServiceWorkerUpdateState {
  /** A new service worker is waiting to activate. */
  updateAvailable: boolean;
  /** Trigger the update: sends SKIP_WAITING to the new SW and reloads. */
  activateUpdate: () => void;
}

/**
 * Monitors the service worker lifecycle and exposes whether a new version
 * is waiting. Returns a stable `activateUpdate` callback that tells the
 * waiting worker to take over and reloads the page.
 *
 * No-ops inside Electron (desktop updates are handled separately).
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const activatedByThisTabRef = useRef(false);

  useEffect(() => {
    if (isElectron) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let intervalId: number | null = null;
    const stateChangeCleanups: Array<{ worker: ServiceWorker; handler: () => void }> = [];

    const trackWaiting = (worker: ServiceWorker | null) => {
      if (disposed || !worker) return;
      waitingWorkerRef.current = worker;
      setUpdateAvailable(true);
    };

    const trackInstalling = (worker: ServiceWorker) => {
      const handler = () => {
        if (worker.state === "installed") {
          trackWaiting(worker);
        }
      };
      worker.addEventListener("statechange", handler);
      stateChangeCleanups.push({ worker, handler });
    };

    void navigator.serviceWorker.ready.then((registration) => {
      if (disposed) return;

      // A worker may already be waiting (e.g. page opened after a deploy).
      if (registration.waiting) {
        trackWaiting(registration.waiting);
      }

      // Watch for a new worker entering the installing phase.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        trackInstalling(installing);
      });

      // Periodically check for SW updates (long-lived SPA).
      intervalId = window.setInterval(() => {
        registration.update().catch(() => {});
      }, CHECK_INTERVAL_MS);
    });

    // When a new SW takes control (after SKIP_WAITING), reload to pick up new assets.
    // Only reload in the tab that initiated the update to avoid disrupting other tabs.
    const onControllerChange = () => {
      if (!disposed && activatedByThisTabRef.current) {
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      disposed = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      for (const { worker, handler } of stateChangeCleanups) {
        worker.removeEventListener("statechange", handler);
      }
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const activateUpdate = useCallback(() => {
    const worker = waitingWorkerRef.current;
    if (worker) {
      activatedByThisTabRef.current = true;
      // ServiceWorker.postMessage() doesn't accept targetOrigin (different API from Window.postMessage).
      // oxlint(unicorn/require-post-message-target-origin) -- not applicable to SW.
      worker.postMessage({ type: "SKIP_WAITING" }); // eslint-disable-line unicorn/require-post-message-target-origin
    }
    // Fallback: if controllerchange doesn't fire within 300ms (e.g. the
    // waiting worker was already promoted to active, or the ref is stale),
    // reload anyway. The SW uses a network-first strategy so a reload
    // always picks up fresh assets from the server.
    setTimeout(() => window.location.reload(), 300);
  }, []);

  return { updateAvailable, activateUpdate };
}
