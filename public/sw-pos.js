const POS_STATIC_CACHE = 'hiroma-pos-static-v5'
const POS_PAGE_CACHE = 'hiroma-pos-pages-v5'
const POS_RUNTIME_CACHE = 'hiroma-pos-runtime-v5'
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
  const activeCaches = new Set([POS_STATIC_CACHE, POS_PAGE_CACHE, POS_RUNTIME_CACHE])
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('hiroma-pos-') && !activeCaches.has(key)).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  if (event.data?.type !== 'CACHE_POS_SHELL') return
  event.waitUntil(
    Promise.all([
      fetch('/dashboard/city/pos', { credentials: 'include' })
        .then((response) => {
          const responseUrl = new URL(response.url)
          if (!response.ok || response.redirected || !responseUrl.pathname.startsWith('/dashboard/city/pos')) return
          return caches.open(POS_PAGE_CACHE).then((cache) => cache.put('/dashboard/city/pos', response))
        }),
      caches.open(POS_RUNTIME_CACHE).then(async (cache) => {
        const assets = Array.isArray(event.data.assets) ? event.data.assets : []
        await Promise.all(assets.filter((path) => typeof path === 'string' && path.startsWith('/_next/static/')).map(async (path) => {
          const response = await fetch(path)
          if (response.ok) await cache.put(path, response)
        }))
      }),
    ])
      .catch(() => undefined),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Authenticated API responses and page data must never be written to Cache Storage.
  if (url.pathname.startsWith('/api/') || request.headers.get('rsc') === '1') return

  if (request.mode === 'navigate' && url.pathname.startsWith('/dashboard/city/pos')) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const responseUrl = new URL(response.url)
          if (response.ok && !response.redirected && responseUrl.pathname.startsWith('/dashboard/city/pos')) {
            const cache = await caches.open(POS_PAGE_CACHE)
            await cache.put(url.pathname, response.clone())
          }
          return response
        } catch {
          return (await caches.match(url.pathname)) || (await caches.match('/dashboard/city/pos')) || (await caches.match('/pos-offline.html'))
        }
      })(),
    )
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    const staticCacheKey = `${url.pathname}${url.search}`
    event.respondWith(
      (async () => {
        const cached = await caches.match(staticCacheKey)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(POS_RUNTIME_CACHE)
          await cache.put(staticCacheKey, response.clone())
        }
        return response
      })(),
    )
    return
  }

  if (POS_STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
  }
})
