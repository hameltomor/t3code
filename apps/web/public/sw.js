// Service worker for PWA installability and push notifications.
// Network-first: always fetch from network, caches only an offline fallback page.

const OFFLINE_CACHE = "xbe-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

// Navigation requests: try network, fall back to cached offline page
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached || new Response("Offline", { status: 503 })),
    ),
  );
});

// Web Push handler — fires even when all tabs are closed
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "XBE Code", {
      body: data.body || "",
      icon: "/pwa-192x192.png",
      badge: "/favicon-32x32.png",
      tag: data.notificationId || undefined,
      data: {
        threadId: data.threadId,
        notificationId: data.notificationId,
      },
    }),
  );
});

// Click handler — focus existing tab or open new window
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { threadId } = event.notification.data || {};
  const targetUrl = threadId ? "/" + threadId : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Try to focus an existing window
        for (const client of windowClients) {
          if (client.focus) {
            return client.focus().then((focusedClient) => {
              if (focusedClient.navigate) {
                return focusedClient.navigate(targetUrl);
              }
            });
          }
        }
        // Otherwise open new window
        return self.clients.openWindow(targetUrl);
      }),
  );
});
