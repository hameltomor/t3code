// Minimal service worker required for PWA installability.
// Network-first: always fetch from network, no offline caching.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
