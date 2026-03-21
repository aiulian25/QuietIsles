const CACHE_NAME = 'quiet-isles-v6';
const STATIC_ASSETS = [
    '/',
    '/css/tailwind.css',
    '/css/app.css',
    '/js/api.js',
    '/js/app.js',
    '/js/components/nav.js',
    '/js/components/card.js',
    '/js/components/map.js',
    '/js/pages/login.js',
    '/js/pages/home.js',
    '/js/pages/explore.js',
    '/js/pages/detail.js',
    '/js/pages/saved.js',
    '/js/pages/memories.js',
    '/js/pages/settings.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/assets/logo.png',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests and cross-origin
    if (event.request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;

    // SPA navigation: always serve cached index.html
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
                    return response;
                })
                .catch(() => caches.match('/').then((r) => r || new Response('Offline', { status: 503 })))
        );
        return;
    }

    // API requests: network first, fallback to cache
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request).then((r) => r || new Response('{"error":"offline"}', {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                })))
        );
        return;
    }

    // Static assets: cache first, fallback to network
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => new Response('', { status: 503 }))
    );
});
