// NairaPlate service worker. Its only job: let the Till and the home screen open with no internet.
// It never touches the database or any other website, and never stores anything secret.
// Keep the cache names and paths below in step with src/lib/offline-shell.ts.
const VERSION = "np-sw-1";
const PAGES = "np-pages-" + VERSION;   // the home screen and Till pages, kept after they have been opened online
const ASSETS = "np-assets";            // the app's own files; their names change with every release, so an old one is harmless
const OFFLINE_PATHS = ["/app", "/pos"];
const MAX_ASSETS = 250;
const NETWORK_WAIT_MS = 4000;

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("np-pages-") && key !== PAGES) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trimAssets(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) { await cache.put(request, res.clone()); void trimAssets(cache); }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  const key = new URL(request.url).pathname;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_WAIT_MS);
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok && res.headers.get("content-type")?.includes("text/html")) await cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    return new Response(
      "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>NairaPlate</title>" +
      "<body style='font-family:sans-serif;padding:24px'><h1>No internet</h1><p>Open the Till once while you are online, then it will open here without internet.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;          // the database, fonts and everything else: never touched
  if (url.pathname.startsWith("/api/")) return;              // server calls always go live
  if (url.pathname.startsWith("/assets/")) { event.respondWith(cacheFirst(request)); return; }
  if (request.mode === "navigate" && OFFLINE_PATHS.includes(url.pathname)) event.respondWith(networkFirst(request));
});
