import type { AppNotification } from "@xbetools/contracts";
import { getAppSettingsSnapshot } from "../appSettings";
import { APP_DISPLAY_NAME } from "../branding";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
export const isAndroid = /Android/.test(ua);
export const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
export const isFirefox = /Firefox\//i.test(ua);

/** Running as an installed PWA (Add-to-Home-Screen / standalone). */
export const isStandalonePWA =
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);

/** iOS Safari in-browser (not installed as PWA) — push not available here. */
export const isIOSSafariBrowser = isIOS && isSafari && !isStandalonePWA;

/** Whether the browser supports the Notification API at all. */
export function supportsNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Whether push notifications can work on this platform/context. */
export function supportsPush(): boolean {
  if (isIOSSafariBrowser) return false;
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof PushManager !== "undefined"
  );
}

// ---------------------------------------------------------------------------
// Permission denied instructions (platform-specific)
// ---------------------------------------------------------------------------

export function getDeniedPermissionInstructions(): string {
  if (isIOS) {
    return "Open Settings \u2192 Apps \u2192 Safari (or your browser) \u2192 Notifications, then allow notifications and reload this page.";
  }
  if (isAndroid) {
    return "Tap the lock icon in the address bar \u2192 Permissions \u2192 Notifications \u2192 Allow, then reload this page.";
  }
  if (isSafari) {
    return "Open Safari \u2192 Settings for this website \u2192 Allow notifications, then reload this page.";
  }
  if (isFirefox) {
    return "Click the lock icon in the address bar \u2192 Clear notification permission, then reload and try again.";
  }
  // Chrome / Edge / generic
  return "Click the lock icon in the address bar \u2192 Site settings \u2192 Notifications \u2192 Allow, then reload this page.";
}

// ---------------------------------------------------------------------------
// Audio with unlock
// ---------------------------------------------------------------------------

let notificationSound: HTMLAudioElement | null = null;
let audioUnlocked = false;

function getNotificationSound(): HTMLAudioElement {
  if (!notificationSound) {
    notificationSound = new Audio("/sounds/notification.mp3");
    notificationSound.volume = 0.5;
  }
  return notificationSound;
}

/**
 * Warm up the audio element on first user gesture so subsequent
 * programmatic plays are not blocked by autoplay policies.
 * Call this once from a top-level interaction listener.
 */
export function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;

  try {
    const audio = getNotificationSound();
    // Play + immediately pause to unlock the audio context.
    // The promise rejection is expected when there is nothing to play yet.
    const p = audio.play();
    if (p) {
      void p
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => {
          // Expected — still counts as unlock attempt on most browsers.
        });
    }
  } catch {
    // Audio not available
  }
}

/** Auto-register one-time unlock on first user gesture. */
export function installAudioUnlockListener(): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = () => {
    unlockAudio();
    window.removeEventListener("click", handler, true);
    window.removeEventListener("touchstart", handler, true);
    window.removeEventListener("keydown", handler, true);
  };

  window.addEventListener("click", handler, true);
  window.addEventListener("touchstart", handler, true);
  window.addEventListener("keydown", handler, true);

  return handler as () => void;
}

export function playNotificationSound(): void {
  const settings = getAppSettingsSnapshot();
  if (!settings.enableNotificationSound) return;

  try {
    const audio = getNotificationSound();
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay policy — requires prior user gesture. Silently fail.
    });
  } catch {
    // Audio not available
  }
}

export async function showNativeNotification(notification: AppNotification): Promise<void> {
  const settings = getAppSettingsSnapshot();
  if (!settings.enableNotifications) return;

  // Only show when page is not focused
  if (document.hasFocus()) return;

  // Check permission before attempting to show
  if (!supportsNotifications() || Notification.permission !== "granted") return;

  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration) return;

    await registration.showNotification(notification.title, {
      body: notification.body,
      icon: "/pwa-192x192.png",
      badge: "/favicon-32x32.png",
      tag: notification.notificationId,
      data: {
        threadId: notification.threadId,
        notificationId: notification.notificationId,
      },
    });
  } catch {
    // Service worker not available or notification permission not granted
  }
}

// ---------------------------------------------------------------------------
// Title badge — shows unread count in browser tab title: "(3) XBE Code"
// ---------------------------------------------------------------------------

export function setTitleBadge(count: number): void {
  document.title = count > 0 ? `(${count}) ${APP_DISPLAY_NAME}` : APP_DISPLAY_NAME;
}

// ---------------------------------------------------------------------------
// App badge — shows unread count on PWA icon in taskbar/dock
// ---------------------------------------------------------------------------

export function updateAppBadge(count: number): void {
  if (!("setAppBadge" in navigator)) return;
  try {
    if (count > 0) {
      void (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> }).setAppBadge(count);
    } else {
      void (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
    }
  } catch {
    // Badging API not available or not in secure context
  }
}

// ---------------------------------------------------------------------------
// Clear stale native notifications (when user returns to app)
// ---------------------------------------------------------------------------

export async function clearStaleNativeNotifications(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration) return;
    const notifications = await registration.getNotifications();
    for (const n of notifications) n.close();
  } catch {
    // Service worker not available
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "granted") {
    return "granted";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  return Notification.requestPermission();
}

export function getNotificationPermission(): NotificationPermission {
  if (!("Notification" in window)) {
    return "denied";
  }
  return Notification.permission;
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    view[i] = rawData.charCodeAt(i);
  }
  return buffer;
}

export async function subscribeToPush(api: {
  getVapidPublicKey: () => Promise<{ publicKey: string | null }>;
  subscribePush: (subscription: {
    endpoint: string;
    p256dhKey: string;
    authKey: string;
  }) => Promise<void>;
}): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration?.pushManager) return false;

    const { publicKey } = await api.getVapidPublicKey();
    if (!publicKey) return false;

    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      // Already subscribed — re-register with server in case it lost the subscription
      const keys = existing.toJSON().keys;
      if (keys?.p256dh && keys?.auth) {
        await api.subscribePush({
          endpoint: existing.endpoint,
          p256dhKey: keys.p256dh,
          authKey: keys.auth,
        });
      }
      return true;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(publicKey),
    });

    const keys = subscription.toJSON().keys;
    if (!keys?.p256dh || !keys?.auth) return false;

    await api.subscribePush({
      endpoint: subscription.endpoint,
      p256dhKey: keys.p256dh,
      authKey: keys.auth,
    });

    return true;
  } catch (error) {
    console.warn("[Push] subscribeToPush failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Listen for push subscription changes from the service worker.
 * When the browser rotates the push subscription, re-register with the server.
 */
export function installPushSubscriptionChangeListener(api: {
  subscribePush: (subscription: {
    endpoint: string;
    p256dhKey: string;
    authKey: string;
  }) => Promise<void>;
}): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};

  const handler = (event: MessageEvent) => {
    if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED" && event.data.subscription) {
      const keys = event.data.subscription.keys as
        | { p256dh?: string; auth?: string }
        | undefined;
      const endpoint = event.data.subscription.endpoint as string | undefined;
      if (keys?.p256dh && keys?.auth && endpoint) {
        void api.subscribePush({
          endpoint,
          p256dhKey: keys.p256dh,
          authKey: keys.auth,
        }).catch((error) => {
          console.warn("[Push] Re-registration after subscription change failed:", error);
        });
      }
    }
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

export async function unsubscribeFromPush(api: {
  unsubscribePush: (endpoint: string) => Promise<void>;
}): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration?.pushManager) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    await api.unsubscribePush(subscription.endpoint);
    await subscription.unsubscribe();
  } catch {
    // Best-effort cleanup
  }
}
