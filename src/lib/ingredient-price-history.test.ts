import { describe, expect, it } from "vitest";
import { PriceHistoryIndex, type PriceHistoryRow } from "./ingredient-price-history";

const row = (p: Partial<PriceHistoryRow>): PriceHistoryRow => ({
  id: crypto.randomUUID(), seq: 1, ingredient_id: "rice", price_track: "current", grade: "A", season: "normal",
  cost_per_base_unit_kobo: 1000, effective_from: "2026-06-01T00:00:00Z", source_type: "purchase", is_backfilled: false, ...p,
});

describe("PriceHistoryIndex.priceAt", () => {
  const idx = new PriceHistoryIndex([
    row({ seq: 3, effective_from: "2026-07-01T00:00:00Z", cost_per_base_unit_kobo: 1500 }),
    row({ seq: 1, is_backfilled: true, source_type: "backfill_purchase" }),
    row({ seq: 4, effective_from: "2026-07-01T00:00:00Z", cost_per_base_unit_kobo: 1400, source_type: "purchase_reversal" }),
    row({ seq: 5, price_track: "A", cost_per_base_unit_kobo: 2000 }),
    row({ seq: 6, effective_from: "2026-08-01T00:00:00Z", cost_per_base_unit_kobo: 0, source_type: "purchase_reversal" }),
  ]);

  it("says unavailable before the earliest known price, never substitutes it", () => {
    expect(idx.priceAt("rice", "current", "2026-03-01T00:00:00Z")).toMatchObject({ status: "unavailable_before_history", cost_kobo: null });
  });
  it("labels backfilled prices", () => {
    expect(idx.priceAt("rice", "current", "2026-06-15T00:00:00Z")).toMatchObject({ status: "historical_backfilled", cost_kobo: 1000 });
  });
  it("same moment: the last recorded wins", () => {
    expect(idx.priceAt("rice", "current", "2026-07-01T00:00:00Z").cost_kobo).toBe(1400);
  });
  it("a missing grade is unavailable, never another grade", () => {
    expect(idx.priceAt("rice", "B", "2026-07-15T00:00:00Z").status).toBe("unavailable_before_history");
    expect(idx.priceAt("rice", "A", "2026-07-15T00:00:00Z").cost_kobo).toBe(2000);
  });
  it("a zero row means no price at that time", () => {
    expect(idx.priceAt("rice", "current", "2026-09-01T00:00:00Z")).toMatchObject({ status: "no_price_at_time", cost_kobo: null });
  });
});
