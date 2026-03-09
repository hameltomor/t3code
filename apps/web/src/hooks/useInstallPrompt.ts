import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron } from "../env";
import { isIOS, isStandalonePWA } from "../lib/notifications";

export interface InstallPromptState {
  /** Whether the install prompt is available (Android/desktop Chrome). */
  canInstall: boolean;
  /** Whether the user is on iOS (needs manual Add-to-Home-Screen instructions). */
  showIOSInstructions: boolean;
  /** Trigger the native install dialog. */
  promptInstall: () => void;
  /** Dismiss the install banner for the rest of this session. */
  dismiss: () => void;
  /** Whether the banner should be visible. */
  visible: boolean;
}

const DISMISSED_KEY = "xbecode:install-dismissed";

/**
 * Captures the `beforeinstallprompt` event and exposes install state.
 *
 * On Android/desktop Chrome, fires the native install dialog on demand.
 * On iOS, exposes `showIOSInstructions` so the UI can show manual instructions.
 *
 * No-ops inside Electron and standalone PWA mode.
 */
export function useInstallPrompt(): InstallPromptState {
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (isElectron || isStandalonePWA) return;

    const handler = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    const onInstalled = () => {
      setCanInstall(false);
      deferredPromptRef.current = null;
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(() => {
    const prompt = deferredPromptRef.current;
    if (!prompt) return;
    void prompt.prompt();
    void prompt.userChoice.then((result) => {
      if (result.outcome === "accepted") {
        setCanInstall(false);
      }
      deferredPromptRef.current = null;
    });
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Best-effort persistence
    }
  }, []);

  // On iOS Safari, show manual instructions (beforeinstallprompt never fires)
  const showIOSInstructions = isIOS && !isStandalonePWA && !isElectron;

  return {
    canInstall,
    showIOSInstructions,
    promptInstall,
    dismiss,
    visible: (canInstall || showIOSInstructions) && !dismissed,
  };
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}
