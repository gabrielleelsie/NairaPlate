// Starts the service worker (public/sw.js) so the home screen and Till open with no internet, and keeps the app's files
// and the current page ready for that. Client only. Keep the names below in step with public/sw.js.
export const SW_PAGES_CACHE = "np-pages-np-sw-1";
export const SW_ASSETS_CACHE = "np-assets";
export const OFFLINE_PATHS = ["/app", "/pos"];

/** Only a real, top-level, secure page may use the offline shell: never a preview frame, never plain http. */
export function offlineShellAllowed(env: { isTop: boolean; secure: boolean; hostname: string; hasServiceWorker: boolean }): boolean {
  if (!env.hasServiceWorker || !env.isTop || !env.secure) return false;
  return !/(^|\.)lovable\.(app|dev)$|^id-preview--|^localhost$|^127\.0\.0\.1$/.test(env.hostname);
}

/** Same-origin build files (under /assets/) among the addresses a page has loaded. */
export function assetUrlsToKeep(loaded: string[], origin: string): string[] {
  const out = new Set<string>();
  for (const raw of loaded) {
    try {
      const u = new URL(raw);
      if (u.origin === origin && u.pathname.startsWith("/assets/")) out.add(u.origin + u.pathname + u.search);
    } catch { /* not an address */ }
  }
  return [...out];
}

export async function registerOfflineShell(): Promise<void> {
  if (typeof window === "undefined") return;
  const ok = offlineShellAllowed({
    isTop: window.self === window.top, secure: window.isSecureContext, hostname: window.location.hostname,
    hasServiceWorker: "serviceWorker" in navigator,
  });
  if (!ok) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    // Once the page has settled, keep every build file it used, and the page itself, so the next start works with no internet.
    const keep = async () => {
      try {
        const assets = await caches.open(SW_ASSETS_CACHE);
        const loaded = performance.getEntriesByType("resource").map((e) => e.name);
        await Promise.all(assetUrlsToKeep(loaded, window.location.origin).map(async (u) => { if (!(await assets.match(u))) await assets.add(u).catch(() => {}); }));
        if (OFFLINE_PATHS.includes(window.location.pathname)) {
          const res = await fetch(window.location.pathname, { cache: "reload" });
          if (res.ok && res.headers.get("content-type")?.includes("text/html")) await (await caches.open(SW_PAGES_CACHE)).put(window.location.pathname, res);
        }
      } catch { /* best effort: the Till still works online */ }
    };
    window.setTimeout(() => void keep(), 3000);
  } catch { /* no service worker: the app works as before, online */ }
}
