// sw.js — Milk PWA (safe: never cache /api/*)

const CACHE = "milk-v6"; // ZMIENIAJ NUMER przy każdej aktualizacji!

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 🔥 NIE CACHE'UJ API
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML: zawsze network-first (żeby aktualizacje wchodziły)
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request);
        const cache = await caches.open(CACHE);
        cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(event.request);
        return cached || Response.error();
      }
    })());
    return;
  }

  // reszta: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const fresh = await fetch(event.request);
    const cache = await caches.open(CACHE);
    cache.put(event.request, fresh.clone());
    return fresh;
  })());
});
