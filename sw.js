const CACHE_NAME = 'expense-tracker-v8';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/db.js',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Skip SheetJS CDN, API routes, and Auth Redirects from SW handling
    const url = new URL(event.request.url);
    if (
        url.hostname.includes('cdn.sheetjs.com') ||
        url.pathname.includes('/api/') ||
        url.search.includes('type=magiclink') ||
        url.search.includes('type=recovery') ||
        url.hash.includes('access_token=')
    ) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    // Network-First Strategy
    // Try to get the latest fresh data from the network over checking the cache
    event.respondWith(
        fetch(event.request).then((response) => {
            // Save a clone in the cache in case device goes offline later
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
        }).catch(() => {
            // If offline or network fails, fallback to the latest stored cache
            return caches.match(event.request);
        })
    );
});

// ============================================
// PUSH NOTIFICATIONS
// ============================================

self.addEventListener('push', function (event) {
    if (event.data) {
        try {
            const payload = event.data.json();
            const title = payload.title || 'Expense Tracker';
            const options = {
                body: payload.body || 'Tens uma nova notificação.',
                icon: payload.icon || '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                vibrate: [100, 50, 100],
                data: {
                    dateOfArrival: Date.now(),
                    primaryKey: 1
                }
            };
            event.waitUntil(self.registration.showNotification(title, options));
        } catch (e) {
            console.error('Push payload invalid', e);
        }
    }
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow('/');
        })
    );
});
