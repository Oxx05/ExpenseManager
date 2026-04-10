const CACHE_NAME = 'expense-tracker-v11';
const ASSETS_TO_CACHE = [
    '/app',
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
    // Não intercetar pedidos à API do Supabase nem outros pedidos cross-origin
    if (event.request.url.includes('supabase.co')) {
        return;
    }

    // Só intercetar pedidos same-origin (os assets locais)
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    // Estratégia: Network-first com fallback para cache
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Guardar resposta válida na cache
                if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                }
                return networkResponse;
            })
            .catch(() => {
                // Rede falhou — tentar a cache
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    // Fallback para a página principal se for navegação
                    if (event.request.mode === 'navigate') {
                        return caches.match('/app') || caches.match('/index.html');
                    }
                    return new Response('Offline', { status: 503 });
                });
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
