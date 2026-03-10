// Service worker for PWA installability, push notifications, and offline support.
// SW_VERSION is injected at build time by the swVersion plugin in vite.config.ts.
// Every release bumps package.json version → plugin rewrites this value → browser
// detects a new service worker → update banner appears automatically.

const SW_VERSION = "__SW_VERSION__";
const OFFLINE_CACHE = `xbe-offline-v${SW_VERSION}`;
const APP_SHELL_CACHE = `xbe-app-shell-v${SW_VERSION}`;
const OFFLINE_URL = "/offline.html";
const KNOWN_CACHES = new Set([OFFLINE_CACHE, APP_SHELL_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  // Do NOT call self.skipWaiting() here — the app controls activation
  // via a SKIP_WAITING message so it can prompt the user first.
});

// Allow the app to trigger activation after the user confirms the update.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => !KNOWN_CACHES.has(key)).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

// Navigation requests: network-first with app shell caching.
// Successful responses are cached so the app shell loads offline.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request)
          .then((cached) => cached || caches.match(OFFLINE_URL))
          .then((cached) => cached || new Response("Offline", { status: 503 })),
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

// Click handler — prefer client already at target URL, then any client, then new window
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { threadId } = event.notification.data || {};
  const targetUrl = threadId ? "/" + threadId : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Prefer a client already showing the target URL
        const urlMatch = windowClients.find((client) => {
          try {
            const url = new URL(client.url);
            return url.pathname === targetUrl;
          } catch {
            return false;
          }
        });
        if (urlMatch && urlMatch.focus) {
          return urlMatch.focus();
        }

        // Fall back to any focusable client and navigate it
        const anyClient = windowClients.find((client) => client.focus);
        if (anyClient) {
          return anyClient.focus().then((focusedClient) => {
            if (focusedClient.navigate) {
              return focusedClient.navigate(targetUrl);
            }
          });
        }

        // No existing window — open a new one
        return self.clients.openWindow(targetUrl);
      }),
  );
});

// Handle push subscription rotation — re-subscribe and notify clients
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSubscription = event.oldSubscription;
        const newSubscription = await self.registration.pushManager.subscribe(
          oldSubscription
            ? { userVisibleOnly: true, applicationServerKey: oldSubscription.options.applicationServerKey }
            : { userVisibleOnly: true },
        );

        // Notify all clients to re-register the new subscription with the server
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          // ServiceWorkerClient.postMessage() does not accept targetOrigin
          client.postMessage({
            type: "PUSH_SUBSCRIPTION_CHANGED",
            subscription: newSubscription.toJSON(),
          });
        }
      } catch {
        // Re-subscription failed — clients will need to resubscribe on next visit
      }
    })(),
  );
});
