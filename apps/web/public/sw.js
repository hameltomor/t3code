// Service worker for PWA installability and push notifications.
// Network-first: always fetch from network, no offline caching.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
