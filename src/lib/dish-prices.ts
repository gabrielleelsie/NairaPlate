// Dish selling-price history helpers. The database (dish_prices) is the source of truth; these only label rows for screens.
export type DishPriceRow = {
  id: string;
  price_kobo: number;
  effective_from: string;
  effective_to: string | null;
  source: "backfill" | "owner" | "recipe_change";
  set_by_name: string | null;
};

export type PriceStatus = "scheduled" | "current" | "ended";

export function priceStatus(r: Pick<DishPriceRow, "effective_from" | "effective_to">, nowMs: number): PriceStatus {
  if (Date.parse(r.effective_from) > nowMs) return "scheduled";
  if (r.effective_to && Date.parse(r.effective_to) <= nowMs) return "ended";
  return "current";
}

/** The row that applied at a moment, or null. Rows may be in any order. */
export function priceAt<T extends Pick<DishPriceRow, "effective_from">>(rows: T[], atMs: number): T | null {
  let best: T | null = null;
  for (const r of rows) {
    const t = Date.parse(r.effective_from);
    if (t <= atMs && (!best || t > Date.parse(best.effective_from))) best = r;
  }
  return best;
}

/** "2026-10-05T09:00" typed in Lagos time -> ISO UTC. Lagos is UTC+1 all year. */
export function lagosLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const ms = Date.parse(`${local}:00+01:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function formatLagos(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const SOURCE_LABEL: Record<DishPriceRow["source"], string> = {
  backfill: "Starting price",
  owner: "Set by owner",
  recipe_change: "Recipe or pricing change",
};
