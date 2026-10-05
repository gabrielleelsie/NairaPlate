// Effective-dated ingredient prices (table ingredient_price_history, read only through
// ingredient_price_history_for()). Pure helpers so P&L and the screen resolve prices the same way.
// Rule: if no price is known at a moment, say so. Never substitute another time's or another grade's price.

export type PriceTrack = "current" | "A" | "B" | "C";

export type PriceHistoryRow = {
  id: string;
  seq: number;
  ingredient_id: string;
  price_track: PriceTrack;
  grade: string | null;
  season: string | null;
  cost_per_base_unit_kobo: number;
  effective_from: string;
  source_type: string;
  source_reference?: string | null;
  is_backfilled: boolean;
  backfill_basis?: string | null;
};

export type CostBasisStatus = "historical_exact" | "historical_backfilled" | "no_price_at_time" | "unavailable_before_history";

export type ResolvedPrice = { status: CostBasisStatus; cost_kobo: number | null; row: PriceHistoryRow | null };

type RawRow = {
  id: unknown; seq: unknown; ingredient_id: unknown; price_track: unknown; grade?: string | null; season?: string | null;
  cost_per_base_unit_kobo: unknown; effective_from: unknown; source_type: unknown; source_reference?: string | null;
  is_backfilled?: unknown; backfill_basis?: string | null;
};

export function normaliseHistoryRows(data: unknown[] | null | undefined): PriceHistoryRow[] {
  return ((data ?? []) as RawRow[]).map((x) => ({
    id: String(x.id), seq: Number(x.seq), ingredient_id: String(x.ingredient_id), price_track: String(x.price_track) as PriceTrack,
    grade: x.grade ?? null, season: x.season ?? null,
    cost_per_base_unit_kobo: Number(x.cost_per_base_unit_kobo), effective_from: String(x.effective_from),
    source_type: String(x.source_type), source_reference: x.source_reference ?? null,
    is_backfilled: Boolean(x.is_backfilled), backfill_basis: x.backfill_basis ?? null,
  }));
}

/** Same ordering as the database: effective_from, then recording order (seq). */
const later = (a: PriceHistoryRow, b: PriceHistoryRow) => {
  const d = Date.parse(a.effective_from) - Date.parse(b.effective_from);
  return d !== 0 ? d : a.seq - b.seq;
};

export class PriceHistoryIndex {
  private byKey = new Map<string, PriceHistoryRow[]>();
  constructor(rows: PriceHistoryRow[]) {
    for (const r of rows) {
      const k = `${r.ingredient_id}|${r.price_track}`;
      const list = this.byKey.get(k) ?? [];
      list.push(r);
      this.byKey.set(k, list);
    }
    for (const list of this.byKey.values()) list.sort(later);
  }
  get size() { return this.byKey.size; }

  /** Price in force at `at` on one exact track. */
  priceAt(ingredientId: string, track: PriceTrack, at: Date | string): ResolvedPrice {
    const t = typeof at === "string" ? Date.parse(at) : at.getTime();
    const list = this.byKey.get(`${ingredientId}|${track}`) ?? [];
    let found: PriceHistoryRow | null = null;
    for (const r of list) { if (Date.parse(r.effective_from) <= t) found = r; else break; }
    if (!found) return { status: "unavailable_before_history", cost_kobo: null, row: null };
    if (found.cost_per_base_unit_kobo <= 0) return { status: "no_price_at_time", cost_kobo: null, row: found };
    return { status: found.is_backfilled ? "historical_backfilled" : "historical_exact", cost_kobo: found.cost_per_base_unit_kobo, row: found };
  }
}

export function sourceLabel(r: Pick<PriceHistoryRow, "source_type" | "backfill_basis">): string {
  switch (r.source_type) {
    case "purchase": return "Purchase";
    case "purchase_reversal": return "Purchase reversed";
    case "price_change": return "Price changed by hand";
    case "backfill_purchase": return "Purchase (from earlier records)";
    case "backfill_reversal": return "Purchase reversed (from earlier records)";
    case "migration_baseline":
      return r.backfill_basis === "known_from_migration" ? "Price known from the day history started" : "Last price change (from earlier records)";
    default: return r.source_type;
  }
}
