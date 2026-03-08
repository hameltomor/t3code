import type { AppNotification } from "@xbetools/contracts";
import { getAppSettingsSnapshot } from "../appSettings";

let notificationSound: HTMLAudioElement | null = null;

function getNotificationSound(): HTMLAudioElement {
  if (!notificationSound) {
    notificationSound = new Audio("/sounds/notification.mp3");
    notificationSound.volume = 0.5;
  }
  return notificationSound;
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
  } catch {
    return false;
  }
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
