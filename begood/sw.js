const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'begood-shell-v';
const CACHE = PREFIX + VERSION;
const SHELL = [
  './',
  './index.html',
  './prepaint.js',
  './i18n.js',
  './app.js',
  './main.js',
  './bigown.css',
  './style.css',
  './manifest.json',
  './icon.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (
    url.hostname.endsWith('firebasedatabase.app') ||
    url.hostname.endsWith('firebaseio.com') ||
    url.hostname === 'www.gstatic.com' ||
    url.hostname.endsWith('googleapis.com')
  ) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response?.ok) caches.open(CACHE).then((cache) => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response?.ok && response.type === 'basic') {
          caches.open(CACHE).then((cache) => cache.put(new Request(url.origin + url.pathname), response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
