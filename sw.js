const CACHE = "msb-admin-v1";
const ASSETS = [
  "/admin.html",
  "/manifest.json",
  "/mnt/data/3db59495-772a-4e81-b1ce-ac7e1504f75a.png"
];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e=>{
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", e=>{
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request))
  );
});
