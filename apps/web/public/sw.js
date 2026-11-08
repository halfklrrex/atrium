/* global self, URL */
// Atrium service worker. It takes control immediately, shows web push notifications and opens the
// deep link when one is clicked. No precaching, no runtime caching and no fetch handler, so a deploy
// is never held back by a stale cache. See docs/pwa.md.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const TITLE_MAX = 200;
const BODY_MAX = 400;

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// Reads the data-only FCM payload { title, body, url, tag, kind }. Returns null for anything that
// is not an object with a title, so a malformed push is ignored.
function parsePush(event) {
  try {
    const payload = event.data ? event.data.json() : null;
    if (!payload || typeof payload !== 'object') return null;
    // FCM web push wraps the data fields under `data` in some transports.
    const data =
      payload.data && typeof payload.data === 'object' && !payload.title ? payload.data : payload;
    const title = text(data.title, TITLE_MAX);
    if (!title) return null;
    return {
      title,
      body: text(data.body, BODY_MAX),
      url: text(data.url, 2000),
      tag: text(data.tag, 200),
      kind: text(data.kind, 50),
    };
  } catch {
    return null;
  }
}

// Same-origin URL (absolute href) or null. Relative paths resolve against this origin.
function sameOriginHref(url) {
  try {
    const resolved = new URL(url || '/', self.location.origin);
    return resolved.origin === self.location.origin ? resolved.href : null;
  } catch {
    return null;
  }
}

// WebKit (iPhone, iPad) revokes a push subscription that receives pushes without showing a
// notification, so there the in-app suppression below is skipped.
function isWebKitPush() {
  return /iPhone|iPad|iPod/i.test((self.navigator && self.navigator.userAgent) || '');
}

function atriumIsInFront() {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => list.some((c) => c.focused && c.visibilityState === 'visible'));
}

self.addEventListener('push', (event) => {
  const push = parsePush(event);
  if (!push) return;
  const show = () => {
    const options = {
      body: push.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: push.url },
    };
    if (push.tag) options.tag = push.tag;
    return self.registration.showNotification(push.title, options);
  };
  // The in-app bell already tells the person when Atrium is open in front of them.
  event.waitUntil(
    isWebKitPush() ? show() : atriumIsInFront().then((inFront) => (inFront ? undefined : show())),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const href = sameOriginHref(data && typeof data.url === 'string' ? data.url : '');
  // Only same-origin links are ever opened.
  if (!href) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => sameOriginHref(c.url));
      if (!existing) return self.clients.openWindow(href);
      return existing
        .focus()
        .then((focused) =>
          'navigate' in (focused || existing) ? (focused || existing).navigate(href) : null,
        )
        .catch(() => self.clients.openWindow(href));
    }),
  );
});
