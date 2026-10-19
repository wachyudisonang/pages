// grocery service worker — shell offline launch (webapp-pwa-standards §12).
// Registers only in a secure context (HTTPS hub) — the inline registration in index.html guards that,
// so this no-ops on plain-HTTP dev. Cache version comes from this sw.js's OWN registration URL
// ?v=<app-version> (deploy-stamped), so a new deploy makes a new cache AND a byte-changed sw.js the
// browser re-installs. Shell-only: Firebase/RTDB are NEVER cached (local storage/IndexedDB owns data).
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'grocery-shell-v' + VERSION;
const SHELL = ['./', './index.html', './app.js', './style.css', './manifest.json', './icon.png', './icon-512.png'];

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith('grocery-shell-v') && k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});
self.addEventListener('fetch', (e) => {
	const req = e.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	// NETWORK-ONLY for live data + the Firebase SDK CDN — a stale cached record/SDK is worse than a
	// failed fetch; the app's own storage is the offline data story.
	if (url.hostname.endsWith('firebasedatabase.app') || url.hostname === 'www.gstatic.com' || url.hostname.endsWith('googleapis.com')) {
		return;
	}
	if (url.origin !== self.location.origin) return;
	// NAVIGATION (the HTML) — NETWORK-FIRST so a new deploy always reaches the device (the HTML points
	// at the ?v=-stamped assets; cache-first HTML would pin the device on the old shell forever —
	// the Android "stuck on stale shell" bug). Cached index.html only when offline.
	if (req.mode === 'navigate') {
		e.respondWith(
			fetch(req).then((res) => {
				if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); }
				return res;
			}).catch(() => caches.match('./index.html').then((h) => h || caches.match('./')))
		);
		return;
	}
	// SHELL ASSETS (same-origin non-navigation, each ?v=<stamp>-stamped). NETWORK-FIRST: a new deploy
	// changes ?v= and we must fetch the new bytes online — cache-first/ignoreSearch would serve the
	// FIRST-cached asset forever and freeze the app at the old version. Refresh the cache under the bare
	// path; fall back to the cached copy (ignoreSearch) only when offline.
	e.respondWith(
		fetch(req).then((res) => {
			if (res && res.ok && res.type === 'basic') {
				const copy = res.clone();
				caches.open(CACHE).then((c) => c.put(new Request(url.origin + url.pathname), copy));
			}
			return res;
		}).catch(() => caches.match(req, { ignoreSearch: true }))
	);
});
