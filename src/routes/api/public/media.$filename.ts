import { createFileRoute } from "@tanstack/react-router";

import adminDemoAsset from "@/assets/nairaplate-admin-demo.mp4.asset.json";
import adminPosterAsset from "@/assets/nairaplate-admin-poster.jpg.asset.json";
import priceCalculatorDemoAsset from "@/assets/nairaplate-price-calculator-demo.mp4.asset.json";
import priceCalculatorPosterAsset from "@/assets/nairaplate-price-calculator-poster.jpg.asset.json";
import walkthroughAsset from "@/assets/nairaplate-walkthrough.mp4.asset.json";
import walkthroughPosterAsset from "@/assets/nairaplate-walkthrough-poster.jpg.asset.json";

const MEDIA_ORIGIN = "https://id-preview--bbbf4c9a-1779-4134-b130-41f2d8e91702.lovable.app";
const MEDIA: Record<string, { path: string; type: string }> = {
  "nairaplate-price-calculator-demo.mp4": { path: priceCalculatorDemoAsset.url, type: "video/mp4" },
  "nairaplate-price-calculator-poster.jpg": { path: priceCalculatorPosterAsset.url, type: "image/jpeg" },
  "nairaplate-walkthrough.mp4": { path: walkthroughAsset.url, type: "video/mp4" },
  "nairaplate-walkthrough-poster.jpg": { path: walkthroughPosterAsset.url, type: "image/jpeg" },
  "nairaplate-admin-demo.mp4": { path: adminDemoAsset.url, type: "video/mp4" },
  "nairaplate-admin-poster.jpg": { path: adminPosterAsset.url, type: "image/jpeg" },
};

async function serveMedia(request: Request, filename: string, headOnly = false) {
  const media = MEDIA[filename];
  if (!media) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  const requestHeaders = new Headers();
  if (range) requestHeaders.set("Range", range);
  const upstream = await fetch(`${MEDIA_ORIGIN}${media.path}`, {
    method: headOnly ? "HEAD" : "GET",
    headers: requestHeaders,
  });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Media unavailable", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": media.type,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  });
  for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(headOnly ? null : upstream.body, { status: upstream.status, headers });
}

export const Route = createFileRoute("/api/public/media/$filename")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveMedia(request, params.filename),
      HEAD: ({ request, params }) => serveMedia(request, params.filename, true),
    },
  },
});