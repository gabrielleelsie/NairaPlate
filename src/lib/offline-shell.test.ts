import { describe, expect, it } from "vitest";
import { assetUrlsToKeep, offlineShellAllowed } from "./offline-shell";

const live = { isTop: true, secure: true, hostname: "nairaplate.com", hasServiceWorker: true };

describe("offlineShellAllowed", () => {
  it("allows the live site", () => expect(offlineShellAllowed(live)).toBe(true));
  it("refuses a frame, plain http, or a browser with no service workers", () => {
    expect(offlineShellAllowed({ ...live, isTop: false })).toBe(false);
    expect(offlineShellAllowed({ ...live, secure: false })).toBe(false);
    expect(offlineShellAllowed({ ...live, hasServiceWorker: false })).toBe(false);
  });
  it("refuses preview and local addresses", () => {
    for (const hostname of ["id-preview--abc.lovable.app", "something.lovable.app", "localhost", "127.0.0.1"])
      expect(offlineShellAllowed({ ...live, hostname })).toBe(false);
  });
});

describe("assetUrlsToKeep", () => {
  const origin = "https://nairaplate.com";
  it("keeps only this site's build files, once each", () => {
    const out = assetUrlsToKeep([
      "https://nairaplate.com/assets/index-abc.js", "https://nairaplate.com/assets/index-abc.js", "https://nairaplate.com/assets/app-1.css",
      "https://nairaplate.com/api/public/x", "https://ckklehqascyglqnqtwpn.supabase.co/rest/v1/recipes", "https://fonts.googleapis.com/css2?family=Figtree",
      "not an address", "https://nairaplate.com/media/video.mp4",
    ], origin);
    expect(out).toEqual(["https://nairaplate.com/assets/index-abc.js", "https://nairaplate.com/assets/app-1.css"]);
  });
});
