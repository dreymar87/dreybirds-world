/* DreyBird service worker — hand-rolled, no dependencies.
   Bump CACHE to ship an update; the old cache is dropped on activate. */

const CACHE = 'dbw-v4';   // bumped when the app shell changes
const RUNTIME = 'dbw-runtime-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE && n !== RUNTIME).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // The pixel typeface: serve what we have, refresh in the background.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Any navigation inside our scope resolves to the game itself.
  if (req.mode === 'navigate') {
    event.respondWith(pageFirst(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

/* Navigations go to the network first and fall back to the cache.

   Cache-first was the obvious choice and it was wrong. The whole game is
   one index.html, so serving it from the cache meant handing back the
   previous build on every load; the browser only notices a changed sw.js
   *after* the page has already been answered, so a fix shipped on Monday
   first appeared on the second launch. Nobody should have to open the game
   twice to see a change.

   The font host's rule applies here too, and more sharply, because this is
   the page itself: respondWith must always settle, and a network that
   accepts the request and never answers must not be able to hang the game.
   So the network races a short timer, and the cache answers if the timer
   wins — offline, on a captive portal, or on a hotel wifi that swallows
   requests, the last good build still starts. */
const NAV_TIMEOUT = 2500;

function pageFirst(req) {
  const cached = () => caches.match('./index.html', { ignoreSearch: true })
    .then(hit => hit || caches.match('./'))
    .then(hit => hit || new Response(
      '<!doctype html><meta charset="utf-8"><title>DreyBird</title>' +
      '<p style="font:16px/1.5 system-ui;padding:24px">DreyBird is not cached on ' +
      'this device yet, and the network did not answer. Reconnect and reload.</p>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } }));

  // A 404 or a 500 is not a build; fall through to the cache rather than
  // replacing a working game with an error page.
  const network = fetch(req).then(res => {
    if (!res || !res.ok) return null;
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put('./index.html', copy));
    return res;
  }).catch(() => null);

  const giveUp = new Promise(resolve => setTimeout(resolve, NAV_TIMEOUT, null));
  return Promise.race([network, giveUp]).then(res => res || cached());
}

function cacheFirst(req) {
  return caches.match(req, { ignoreSearch: true }).then(hit => {
    const network = fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    });
    return hit || network;
  });
}

/* The font host is optional, so nothing here may ever hang on it.
   respondWith() that never settles leaves the request pending, and a
   pending stylesheet blocks the parser from running the scripts after it
   — the whole page sits at readyState "loading" forever. That is a hang
   on any captive portal or blackholed network, which is far worse than
   simply not having the pixel typeface. */
const FONT_TIMEOUT = 3000;

function staleWhileRevalidate(req) {
  return caches.open(RUNTIME).then(cache =>
    cache.match(req).then(hit => {
      const network = fetch(req)
        .then(res => {
          // Opaque font responses are cacheable and still usable.
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (hit) return hit;

      // Whatever happens, settle. An empty stylesheet is a fine answer:
      // the page has a real fallback stack and carries on.
      const giveUp = new Promise(resolve => setTimeout(resolve, FONT_TIMEOUT, null));
      return Promise.race([network, giveUp])
        .then(res => res || new Response('', {
          status: 200,
          headers: { 'content-type': 'text/css' }
        }));
    })
  );
}
