import { useCallback, useEffect, useState } from "react";
import type { DesktopUpdateState } from "@xbetools/contracts";
import { isElectron } from "../env";
import { useServiceWorkerUpdate } from "./useServiceWorkerUpdate";
import {
  resolveDesktopUpdateButtonAction,
  shouldShowDesktopUpdateButton,
  getDesktopUpdateActionError,
  shouldToastDesktopUpdateActionResult,
} from "../components/desktopUpdate.logic";
import { toastManager } from "../components/ui/toast";

export type AppUpdateStatus = "idle" | "available" | "downloading" | "ready" | "error";

export interface AppUpdateInfo {
  status: AppUpdateStatus;
  /** Version string, if known (desktop only). */
  version: string | null;
  /** Download progress 0–100 (desktop only). */
  progress: number | null;
  /** Primary action: reload (browser) or download/install (desktop). */
  action: () => void;
  /** Dismiss the banner until next check cycle. */
  dismiss: () => void;
  /** Whether the banner should be visible. */
  visible: boolean;
}

/**
 * Unified update hook — returns the same shape regardless of whether the app
 * is running in a browser (SW lifecycle) or Electron (electron-updater IPC).
 */
export function useAppUpdate(): AppUpdateInfo {
  const [dismissed, setDismissed] = useState(false);

  // --- Browser path (service worker) ---
  const sw = useServiceWorkerUpdate();

  // --- Desktop path (Electron) ---
  const [desktopState, setDesktopState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscription = false;

    const unsubscribe = bridge.onUpdateState((next) => {
      if (disposed) return;
      receivedSubscription = true;
      setDesktopState(next);
      // Reset dismiss when new update info arrives.
      setDismissed(false);
    });

    void bridge
      .getUpdateState()
      .then((next) => {
        if (disposed || receivedSubscription) return;
        setDesktopState(next);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // --- Resolve unified state ---

  const dismiss = useCallback(() => setDismissed(true), []);

  if (isElectron) {
    return resolveDesktopUpdate(desktopState, dismissed, dismiss);
  }

  return resolveBrowserUpdate(sw, dismissed, dismiss);
}

// ---------------------------------------------------------------------------
// Browser resolution
// ---------------------------------------------------------------------------

function resolveBrowserUpdate(
  sw: ReturnType<typeof useServiceWorkerUpdate>,
  dismissed: boolean,
  dismiss: () => void,
): AppUpdateInfo {
  if (!sw.updateAvailable) {
    return idle(dismiss);
  }

  return {
    status: "available",
    version: null,
    progress: null,
    action: sw.activateUpdate,
    dismiss,
    visible: !dismissed,
  };
}

// ---------------------------------------------------------------------------
// Desktop resolution
// ---------------------------------------------------------------------------

function resolveDesktopUpdate(
  state: DesktopUpdateState | null,
  dismissed: boolean,
  dismiss: () => void,
): AppUpdateInfo {
  if (!shouldShowDesktopUpdateButton(state) || !state) {
    return idle(dismiss);
  }

  const buttonAction = resolveDesktopUpdateButtonAction(state);
  const version = state.availableVersion ?? state.downloadedVersion;

  const action = () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    if (buttonAction === "download") {
      void bridge.downloadUpdate().then((result) => {
        if (result.completed) {
          toastManager.add({
            type: "success",
            title: "Update downloaded",
            description: "Restart the app from the update button to install it.",
          });
        }
        if (!shouldToastDesktopUpdateActionResult(result)) return;
        const error = getDesktopUpdateActionError(result);
        if (error) {
          toastManager.add({ type: "error", title: "Could not download update", description: error });
        }
      });
    } else if (buttonAction === "install") {
      void bridge.installUpdate().then((result) => {
        if (!shouldToastDesktopUpdateActionResult(result)) return;
        const error = getDesktopUpdateActionError(result);
        if (error) {
          toastManager.add({ type: "error", title: "Could not install update", description: error });
        }
      });
    }
  };

  let status: AppUpdateStatus;
  if (state.status === "downloaded") {
    status = "ready";
  } else if (state.status === "downloading") {
    status = "downloading";
  } else if (state.status === "error") {
    status = "error";
  } else {
    status = "available";
  }

  return {
    status,
    version,
    progress: state.downloadPercent,
    action,
    dismiss,
    visible: !dismissed,
  };
}

function idle(dismiss: () => void): AppUpdateInfo {
  return {
    status: "idle",
    version: null,
    progress: null,
    action: () => {},
    dismiss,
    visible: false,
  };
}
