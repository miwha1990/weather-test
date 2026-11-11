const CACHE_NAME = 'weatherly-v1'
const APP_URL = new URL(self.registration.scope)
const APP_PATH = APP_URL.pathname
const APP_SHELL = [
  APP_URL.href,
  new URL('manifest.webmanifest', APP_URL).href,
  new URL('favicon-192.png', APP_URL).href,
  new URL('favicon-512.png', APP_URL).href,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL)
      const response = await fetch(APP_URL.href)
      if (!response.ok) throw new Error(`Failed to precache app shell (${response.status}).`)
      await cache.put(APP_URL.href, response.clone())

      const html = await response.text()
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)]
        .map((match) => new URL(match[1], APP_URL))
        .filter((url) => url.origin === self.location.origin && url.pathname.startsWith(APP_PATH))
        .map((url) => url.href)
      await cache.addAll(assets)
    })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('weatherly-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(APP_PATH)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put(APP_URL.href, copy))
          }
          return response
        })
        .catch(async () => {
          const cachedPage = await caches.match(APP_URL.href, { ignoreVary: true })
          if (cachedPage) return cachedPage
          return Response.error()
        }),
    )
    return
  }

  event.respondWith(
    caches.match(request, { ignoreVary: true })
      .then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })),
  )
})
