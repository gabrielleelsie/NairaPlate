import { describe, expect, it } from "vitest";
import { diagnoseMarginChange, robustPrice, type MarginDiagnosticInput } from "./margin-diagnostic";
import type { PnlResult } from "./pnl";

const prevR = { from: new Date("2026-09-20T23:00:00Z"), to: new Date("2026-09-27T23:00:00Z") };
const curR = { from: new Date("2026-09-27T23:00:00Z"), to: new Date("2026-10-04T23:00:00Z") };
const inCur = "2026-09-30T10:00:00Z", inPrev = "2026-09-23T10:00:00Z";

function pnl(dishes: { name: string; plates: number; sales: number; cost: number; channel?: string }[], wastage = 0, orders = 50): PnlResult {
  const sales = dishes.reduce((s, d) => s + d.sales, 0);
  const rc = dishes.reduce((s, d) => s + d.cost, 0);
  const chan = new Map<string, { channel: string; sales_kobo: number; cost_kobo: number }>();
  for (const d of dishes) { const k = d.channel ?? "Walk-in"; const c = chan.get(k) ?? { channel: k, sales_kobo: 0, cost_kobo: 0 }; c.sales_kobo += d.sales; c.cost_kobo += d.cost; chan.set(k, c); }
  return {
    gross_sales_kobo: sales, recipe_cost_of_goods_kobo: rc, wastage_cost_kobo: wastage, cost_of_goods_kobo: rc + wastage,
    gross_margin_kobo: sales - rc - wastage, food_cost_percentage: null, paid_orders: orders, daily: [], warnings: [], limitations: [],
    by_dish: dishes.map((d) => ({ version_id: d.name, name: d.name, plates: d.plates, sales_kobo: d.sales, cost_kobo: d.cost, costed: true })),
    by_channel: [...chan.values()],
  };
}
const base = (over: Partial<MarginDiagnosticInput>): MarginDiagnosticInput => ({
  current: pnl([]), previous: pnl([]), currentRange: curR, previousRange: prevR,
  ingredientNames: new Map([["oil", "Vegetable oil"], ["rice", "Rice"]]), usagePerPlate: new Map(),
  purchases: [], purchaseSpend: [], wastage: [], batches: [], ...over,
});

describe("margin diagnostic", () => {
  it("finds an injected oil price rise", () => {
    const dishes: { name: string; plates: number; sales: number; cost: number }[] = [{ name: "Jollof", plates: 200, sales: 40_000_000, cost: 16_000_000 }];
    const r = diagnoseMarginChange(base({
      previous: pnl(dishes),
      current: pnl([{ ...dishes[0]!, cost: 18_000_000 }]),
      usagePerPlate: new Map([["Jollof", [{ ingredient_id: "oil", base_qty: 0.1 }]]]), // 0.1 L per plate → 20 L
      purchases: [{ ingredient_id: "oil", at: inPrev, per_base_kobo: 200_000 }, { ingredient_id: "oil", at: inCur, per_base_kobo: 300_000 }],
      purchaseSpend: [{ ingredient_id: "oil", at: inCur, total_kobo: 6_000_000 }],
    }));
    expect(r.direction).toBe("down");
    expect(r.change_points).toBeCloseTo(-5, 5);
    const ing = r.drivers.find((d) => d.key === "ingredients")!;
    expect(ing.amount_kobo).toBe(2_000_000); // 20 L × ₦1,000 rise
    expect(ing.points).toBeCloseTo(-5, 5);
    expect(r.other_points).toBeCloseTo(0, 5);
    expect(ing.items[0]!.label).toContain("Vegetable oil (+50%)");
  });

  it("explains a mix shift toward a low-margin dish", () => {
    const prev = pnl([{ name: "Fish", plates: 100, sales: 30_000_000, cost: 6_000_000 }, { name: "Moi-moi", plates: 100, sales: 10_000_000, cost: 6_000_000 }]);
    const cur = pnl([{ name: "Fish", plates: 50, sales: 15_000_000, cost: 3_000_000 }, { name: "Moi-moi", plates: 250, sales: 25_000_000, cost: 15_000_000 }]);
    const r = diagnoseMarginChange(base({ previous: prev, current: cur }));
    const mix = r.drivers.find((d) => d.key === "mix")!;
    expect(mix.points).toBeLessThan(0);
    expect(mix.summary).toContain("lower-margin");
    expect(mix.items.map((i) => i.label)).toContain("Moi-moi");
  });

  it("reports wastage increases and good news framing", () => {
    const d = [{ name: "Rice", plates: 100, sales: 30_000_000, cost: 12_000_000 }];
    const r = diagnoseMarginChange(base({
      previous: pnl(d, 2_000_000), current: pnl(d, 500_000),
      wastage: [{ ingredient_id: "rice", at: inPrev, cost_kobo: 2_000_000 }, { ingredient_id: "rice", at: inCur, cost_kobo: 500_000 }],
    }));
    expect(r.direction).toBe("up");
    expect(r.headline).toContain("improved");
    expect(r.drivers.find((x) => x.key === "wastage")!.points).toBeCloseTo(5, 5);
  });

  it("warns on low data and handles no sales", () => {
    const tiny = pnl([{ name: "Rice", plates: 1, sales: 200_000, cost: 80_000 }], 0, 1);
    expect(diagnoseMarginChange(base({ previous: tiny, current: tiny })).notes[0]).toContain("Too few sales");
    const none = diagnoseMarginChange(base({ previous: pnl([]), current: tiny }));
    expect(none.direction).toBe("unknown");
    expect(none.drivers).toHaveLength(0);
  });

  it("ignores price outliers", () => {
    expect(robustPrice([100, 110, 105, 2000])).toBe(105);
  });
});
