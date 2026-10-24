/* ============================================================================
 * Growth Tracker — service worker
 * Strategy
 *   • app shell  → cache-first (fully offline after the first visit)
 *   • navigation → network, falling back to the cached shell
 *   • fonts/CDN  → stale-while-revalidate runtime cache
 * Old caches are deleted on activate. The app asks the user before reloading
 * when a new version is ready (see initPWA in the app).
 * ==========================================================================*/

var VERSION = 'growth-tracker-v1.28.0';
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  /* self-hosted fonts — cached with the shell so the app renders in its real
     typeface offline, not in a fallback (spec section 3) */
  './fonts/outfit-latin.woff2',
  './fonts/outfit-latin-ext.woff2',
  './fonts/inter-latin.woff2',
  './fonts/inter-latin-ext.woff2',
  './fonts/readex-arabic.woff2',
  './fonts/readex-latin.woff2',
  './fonts/readex-latin-ext.woff2'
];

/* ---------- install: pre-cache the shell ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      /* one-by-one so a single missing file cannot abort the whole install */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    })
  );
});

/* ---------- activate: drop every older cache ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== VERSION) return caches.delete(key);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------- messages from the page ---------- */
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'VERSION') {
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
  }
});

/* ---------- reminder notifications (v1.23.0) ---------- */
self.addEventListener('notificationclick', function (event) {
  var data = (event.notification && event.notification.data) || {};
  var url = data.url || './index.html?focus=today';
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) { try { c.postMessage({ type: 'GT_FOCUS_TODAY' }); } catch (e) {} return c.focus(); }
      }
      return self.clients.openWindow(url);
    }).catch(function () { return self.clients.openWindow(url); })
  );
});

/* ---------- what may enter the cache ----------
 * v1.27.0 — STATIC ASSETS ONLY. The app shell, icons, fonts and stylesheets
 * are the whole point of the cache; a 4.5 MB tutorial video, a JSON backup or
 * a range request is not. Caching them would either fill the origin's quota or
 * store a PARTIAL response as if it were the whole file, and neither failure
 * is visible to the user until something else stops working. User data never
 * passes through here at all: it lives in localStorage, which a service worker
 * cannot read or write. */
var STATIC_DEST = { script: 1, style: 1, font: 1, image: 1, manifest: 1, worker: 1 };
function isStatic(req, url) {
  /* a ranged request answers 206 with a slice — never a cacheable whole */
  try { if (req.headers.get('range')) return false; } catch (e) { return false; }
  if (req.destination) return !!STATIC_DEST[req.destination];
  return /\.(css|js|mjs|json|woff2?|ttf|otf|png|svg|jpe?g|webp|gif|ico)$/i.test(url.pathname);
}

/* ---------- fetch ---------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* navigations: try the network, fall back to the cached shell */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        /* v1.26.2 — ONLY an HTML response may be remembered as the shell.
           The tutorial videos are served from this same origin, so opening
           one in a tab is a navigation too; caching a video under the
           './index.html' key would replace the app shell with 4.5 MB of
           MP4 and break every offline launch afterwards. A response that is
           not HTML is streamed and deliberately NOT stored. */
        var ct = (res.headers && res.headers.get('content-type')) || '';
        if (ct.indexOf('text/html') > -1) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  /* same-origin assets: cache-first — but only the static ones */
  if (url.origin === self.location.origin) {
    if (!isStatic(req, url)) {
      /* straight to the network, nothing stored */
      event.respondWith(fetch(req).catch(function () {
        return caches.match(req).then(function (r) { return r || Response.error(); });
      }));
      return;
    }
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.status === 200 && res.type === 'basic' && isStatic(req, url)) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () {
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* cross-origin (Google Fonts…): serve from cache, refresh in the background */
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
