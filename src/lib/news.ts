// News watch: reads Nigerian news feeds and keeps headlines that mention a watched topic together with a price word
// ("petrol price hike", "tomato prices rise"). Keywords only, no guessing: a headline is stored as published, with its
// outlet, date and link, and never changes any cost or price. Pure functions, shared by the hourly job and the screens.

import { z } from "zod";

export type TopicKey = "fuel" | "transport" | "rice" | "pepper" | "tomatoes" | "onions";
export const TOPIC_LABEL: Record<TopicKey, string> = { fuel: "Fuel", transport: "Transport", rice: "Rice", pepper: "Pepper", tomatoes: "Tomatoes", onions: "Onions" };

// Word-boundary patterns on the HEADLINE, so "price" never counts as "rice".
const TOPICS: Record<TopicKey, RegExp> = {
  fuel: /\b(petrol|diesel|fuel|kerosene|lpg|cooking gas)\b/i,
  transport: /\b(transport(?:ation)?|fares?)\b/i,
  rice: /\brice\b/i,
  pepper: /\b(peppers?|ata rodo|tatashe)\b/i,
  tomatoes: /\btomato(?:es)?\b/i,
  onions: /\bonions?\b/i,
};
// A headline must also talk about price or cost, so "Rice University" or "fuel station fire" are not picked up.
const PRICE_CONTEXT = /\b(prices?|costs?|fares?|hikes?|hiked|surges?|soar(?:s|ed|ing)?|increases?|increased|rise|rises|rising|rose|jumps?|spikes?|climbs?|scarcity|shortage|inflation|pricey|dearer|expensive)\b/i;
const RISING = /\b(hikes?|hiked|surges?|soar(?:s|ed|ing)?|increases?|increased|rise|rises|rising|rose|jumps?|spikes?|climbs?|scarcity|shortage|dearer|expensive)\b/i;

export type Match = { topics: TopicKey[]; rising: boolean };

/** null when the headline is not about a watched topic AND a price. */
export function matchHeadline(title: string, description = ""): Match | null {
  const t = title.trim();
  if (!t) return null;
  const topics = (Object.keys(TOPICS) as TopicKey[]).filter((k) => TOPICS[k].test(t));
  if (topics.length === 0) return null;
  const context = `${t} ${description}`;
  if (!PRICE_CONTEXT.test(t) && !PRICE_CONTEXT.test(stripTags(description))) return null;
  return { topics, rising: RISING.test(context) && RISING.test(t) };
}

export type Feed = { id: string; name: string; url: string };
// Outlet feed addresses. Not all of them are confirmed to work from the server: the job records, per outlet, whether the last read worked.
export const FEEDS: Feed[] = [
  { id: "punch", name: "Punch", url: "https://punchng.com/feed/" },
  { id: "vanguard", name: "Vanguard", url: "https://www.vanguardngr.com/feed/" },
  { id: "businessday", name: "BusinessDay", url: "https://businessday.ng/feed/" },
  { id: "premiumtimes", name: "Premium Times", url: "https://www.premiumtimesng.com/feed" },
  { id: "nairametrics", name: "Nairametrics", url: "https://nairametrics.com/feed/" },
  { id: "dailytrust", name: "Daily Trust", url: "https://dailytrust.com/feed/" },
];

/** The platform-wide switch an admin sets in Settings. On unless switched off. */
export const NEWS_SCHEMA = z.object({ enabled: z.boolean() }).strict();

export const READ_SAMPLE = 8;
export const READ_SAMPLE_KEY = "news_last_read";
export type ReadSample = { title: string; matched: boolean };

/** The first few headlines an outlet's feed gave us, each marked with whether it matched. Shown to the platform admin so a "0 matched" is understandable. */
export function sampleRead(items: { title: string; description?: string }[], max = READ_SAMPLE): ReadSample[] {
  return items.slice(0, max).map((it) => ({ title: it.title.slice(0, 200), matched: matchHeadline(it.title, it.description ?? "") !== null }));
}

export const KEEP_DAYS = 30;
export const SHOW_DAYS = 7;

const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const unCdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
const tag = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? unCdata(m[1] ?? "").trim() : null;
};

export type FeedItem = { title: string; url: string; published_at: Date | null; description: string };

/** Reads RSS 2.0 (<item>) and Atom (<entry>). Skips items with no title or no http(s) link. Never throws. */
export function parseFeed(xml: string, max = 40): FeedItem[] {
  const out: FeedItem[] = [];
  try {
    const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
    for (const b of blocks) {
      if (out.length >= max) break;
      const title = decodeEntities(stripTags(tag(b, "title") ?? "")).slice(0, 300);
      let link = tag(b, "link") ?? "";
      if (!link) link = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(b)?.[1] ?? "";
      link = decodeEntities(unCdata(link)).trim();
      if (!title || !/^https?:\/\//i.test(link)) continue;
      const raw = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
      const d = raw ? new Date(raw) : null;
      out.push({
        title, url: link, published_at: d && !Number.isNaN(d.getTime()) ? d : null,
        description: decodeEntities(stripTags(tag(b, "description") ?? tag(b, "summary") ?? "")).slice(0, 400),
      });
    }
  } catch { /* a broken feed gives no items */ }
  return out;
}

/** "3 hours ago", "2 days ago" for a headline's date. */
export function agoLabel(iso: string | Date, now = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "less than an hour ago";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
