const POS_STATIC_CACHE = 'hiroma-pos-static-v1'
const POS_STATIC_ASSETS = [
  '/pos-offline.html',
  '/pos-icon-192.png',
  '/pos-icon-512.png',
  '/pos-icon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(POS_STATIC_CACHE).then((cache) => cache.addAll(POS_STATIC_ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('hiroma-pos-') && key !== POS_STATIC_CACHE).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Authenticated API responses and page data must never be written to Cache Storage.
  if (url.pathname.startsWith('/api/') || request.headers.get('rsc') === '1') return

  if (request.mode === 'navigate' && url.pathname.startsWith('/dashboard/city/pos')) {
    event.respondWith(fetch(request).catch(() => caches.match('/pos-offline.html')))
    return
  }

  if (POS_STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
  }
})
