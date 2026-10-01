// Season label on a purchase: Plenty / Normal / Scarce. Required on every purchase, chosen by the owner.
// The app only ever HINTS (from the owner's own history) and never fills it in.
export const SEASONS = ["plenty", "normal", "scarce"] as const;
export type Season = (typeof SEASONS)[number];

export const seasonLabel = (s: string | null | undefined): string =>
  s === "plenty" ? "Plenty" : s === "normal" ? "Normal" : s === "scarce" ? "Scarce" : "No season";

export function isSeason(v: unknown): v is Season {
  return v === "plenty" || v === "normal" || v === "scarce";
}

// Pulls a spoken season ("scarce", "it is plenty") out of a transcript.
export function extractSeason(text: string): { season: Season | null; rest: string } {
  const m = /\b(plenty|plentiful|normal|scarce|scarcity)\b/i.exec(text);
  if (!m) return { season: null, rest: text };
  const w = (m[1] ?? "").toLowerCase();
  const season: Season = w.startsWith("plen") ? "plenty" : w === "normal" ? "normal" : "scarce";
  return { season, rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() };
}

export const MIN_HINT_PURCHASES = 6; // fewer than this and a hint would be a guess
const HINT_BAND = 0.15; // 15% below / above the owner's usual price

export type SeasonHint = { season: Season; pctVsUsual: number } | null;

/**
 * Compares this price with the owner's usual price for the SAME ingredient, grade and market unit
 * (median of past prices, price per market unit = total / qty). Returns null with too little history.
 */
export function seasonHint(newUnitPrice: number, pastUnitPrices: number[]): SeasonHint {
  const past = pastUnitPrices.filter((p) => Number.isFinite(p) && p > 0);
  if (past.length < MIN_HINT_PURCHASES || !(newUnitPrice > 0)) return null;
  const sorted = [...past].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const usual = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const ratio = newUnitPrice / usual - 1;
  const pctVsUsual = Math.round(ratio * 1000) / 10;
  if (ratio <= -HINT_BAND) return { season: "plenty", pctVsUsual };
  if (ratio >= HINT_BAND) return { season: "scarce", pctVsUsual };
  return { season: "normal", pctVsUsual };
}
