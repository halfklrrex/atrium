// Atrium service worker (PWA-1). Deliberately minimal: it takes control immediately and nothing
// else. No precaching, no runtime caching and no fetch handler, so a deploy is never held back by
// a stale cache. See docs/pwa.md.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Stub: showing the notification arrives with PWA-4 (push from Firebase Cloud Messaging).
self.addEventListener('push', () => {});

// Stub: focusing or opening the deep link arrives with PWA-4.
self.addEventListener('notificationclick', () => {});
