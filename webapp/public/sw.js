const CACHE = 'race-manager-v2'
// Paths are relative to the registration scope so the app works at / or /roundrobin/.
const scope = new URL(self.registration.scope)
const home = scope.href
const api = new URL('api/', scope).pathname
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([home, new URL('manifest.webmanifest', scope).href, new URL('icon.svg', scope).href]))))
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== scope.origin || url.pathname.startsWith(api) || url.pathname.startsWith('/.netlify/')) return
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone()
    caches.open(CACHE).then(cache => cache.put(event.request, copy))
    return response
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match(home))))
})
