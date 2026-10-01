// news-watch: called every hour by the database scheduler (pg_cron + pg_net in the external Supabase project), never by a
// browser. Reads each outlet's news feed, keeps headlines about fuel, transport, rice, pepper, tomatoes or onions that also
// talk about a price, and stores only the headline, outlet, date and link. Nothing here changes any cost or price.
//
// Auth: "Authorization: Bearer <DAILY_SUMMARY_SECRET>" (the same secret the daily summary uses).
// Body (optional): { dry_run?: boolean }   dry_run -> reads and matches, returns what it found, stores nothing.
// A platform admin can switch the whole thing off in Settings. One outlet failing never stops the others.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sameHex } from "@/lib/daily-summary.server";
import { FEEDS, KEEP_DAYS, READ_SAMPLE_KEY, matchHeadline, parseFeed, sampleRead, type ReadSample } from "@/lib/news";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;
const Body = z.object({ dry_run: z.boolean().optional() });
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readFeed(url: string): Promise<{ xml: string | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal, redirect: "follow",
      headers: { "User-Agent": "NairaPlate news watch (headlines and links only)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
    });
    if (!res.ok) return { xml: null, error: `HTTP ${res.status}` };
    const text = await res.text();
    return { xml: text.slice(0, MAX_BYTES), error: null };
  } catch (e) {
    return { xml: null, error: e instanceof Error && e.name === "AbortError" ? "timed out" : "could not be reached" };
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute("/api/public/news-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["DAILY_SUMMARY_SECRET"];
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!secret || !serviceKey) return json({ error: "Server is not configured." }, 500);
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token || !sameHex(token, secret)) return json({ error: "Unauthorized" }, 401);
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return json({ error: "Invalid request body." }, 400);
        const dry = parsed.data.dry_run ?? false;

        const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: setting } = await admin.from("platform_settings").select("value").eq("key", "news").maybeSingle();
        if (!dry && (setting?.value as { enabled?: boolean } | null)?.enabled === false) return json({ skipped: "switched_off" });

        const now = new Date();
        const { data: prevRead } = await admin.from("platform_settings").select("value").eq("key", READ_SAMPLE_KEY).maybeSingle();
        const readSamples: Record<string, ReadSample[]> = { ...((prevRead?.value as { outlets?: Record<string, ReadSample[]> } | null)?.outlets ?? {}) };
        const results: { source: string; ok: boolean; error?: string; read: number; matched: number; stored: number; samples?: string[]; read_sample?: ReadSample[] }[] = [];
        for (const feed of FEEDS) {
          const { xml, error } = await readFeed(feed.url);
          if (xml === null) {
            results.push({ source: feed.name, ok: false, error: error ?? "failed", read: 0, matched: 0, stored: 0 });
            if (!dry) await admin.from("news_feed_status").upsert({ source: feed.name, feed_url: feed.url, checked_at: now.toISOString(), last_error: error ?? "failed" });
            continue;
          }
          const items = parseFeed(xml);
          if (items.length > 0) readSamples[feed.name] = sampleRead(items);
          const hits = items.flatMap((it) => {
            const m = matchHeadline(it.title, it.description);
            return m ? [{ it, m }] : [];
          });
          let stored = 0;
          if (!dry && hits.length > 0) {
            const rows = hits.map(({ it, m }) => ({
              url: it.url, title: it.title, source: feed.name, published_at: (it.published_at ?? now).toISOString(), topics: m.topics, rising: m.rising,
            }));
            const { data: inserted, error: insErr } = await admin.from("news_items").upsert(rows, { onConflict: "url", ignoreDuplicates: true }).select("id");
            if (!insErr) stored = inserted?.length ?? 0;
          }
          results.push({
            source: feed.name, ok: items.length > 0, read: items.length, matched: hits.length, stored,
            ...(items.length === 0 ? { error: "the feed was reached but had no readable items" } : {}),
            ...(dry ? { samples: hits.slice(0, 3).map((h) => h.it.title), read_sample: sampleRead(items) } : {}),
          });
          if (!dry) {
            await admin.from("news_feed_status").upsert({
              source: feed.name, feed_url: feed.url, checked_at: now.toISOString(),
              ...(items.length > 0 ? { last_ok_at: now.toISOString(), last_error: null } : { last_error: "the feed was reached but had no readable items" }),
              last_item_count: items.length, last_match_count: hits.length,
            });
          }
        }
        if (!dry) await admin.from("platform_settings").upsert({ key: READ_SAMPLE_KEY, value: { read_at: now.toISOString(), outlets: readSamples }, updated_at: now.toISOString() });
        if (!dry) await admin.from("news_items").delete().lt("published_at", new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString());
        return json({ dry_run: dry, outlets: results.length, ok: results.filter((r) => r.ok).length, results });
      },
    },
  },
});
