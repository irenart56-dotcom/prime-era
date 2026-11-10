/* prime era: офлайн-запуск. Сначала отдаём сохранённое, в фоне обновляем. */
const C = "pe-v26";
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(["./", "index.html", "fb.js", "manifest.json", "icon-192.png"]).catch(() => {}))); });
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const mine = u.origin === location.origin, sdk = u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/"), font = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!mine && !sdk && !font) return;
  e.respondWith(caches.open(C).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: mine });
    const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
