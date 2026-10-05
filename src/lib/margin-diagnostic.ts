// "Why did my margin change?" — explains the difference between two periods' gross margin.
// Headline numbers come ONLY from calculateBusinessPnl() (via its by_dish / by_channel breakdown),
// so they always match the P&L and the printable report for the same dates.
// The three drivers are ESTIMATES for interpretation, not exact variance accounting:
//   1. Ingredient price rises — median purchase price per base unit, this period vs last, × amount used by plates sold now.
//   2. Sales mix — dishes (and walk-in vs other channels) whose share of sales moved, weighted by how far their margin was from average.
//   3. Wastage & batch yield — change in logged wastage cost, plus batches that made fewer plates than expected.
// Whatever is left is shown as "other changes" (selling prices, recipe edits, rounding) instead of being hidden.
import type { SupabaseClient } from "@supabase/supabase-js";
import { toBaseQty, type CostConversion, type CostIngredient } from "@/lib/costing";
import { calculateBusinessPnl, type DateRange, type PnlResult } from "@/lib/pnl";
import { livePurchases, normalisePurchases } from "@/lib/purchases";
import { CORRECTION_COLUMNS, standingEntries, type Correctable } from "@/lib/corrections";

// Thresholds (pilot values — tune after seeing real data).
export const PRICE_RISE_MIN_PCT = 5;
export const PRICE_IMPACT_MIN_KOBO = 100_000; // ₦1,000
export const INGREDIENT_SPEND_MIN_KOBO = 500_000; // ₦5,000 spent this period
export const MIX_SHARE_MIN_PP = 2;
export const MIX_IMPACT_MIN_KOBO = 200_000; // ₦2,000
export const LOW_DATA_SALES_KOBO = 2_000_000; // ₦20,000
export const LOW_DATA_ORDERS = 10;
export const YIELD_DROP_MIN_PP = 5;
const OUTLIER_FACTOR = 3;

export type PriceObs = { ingredient_id: string; at: string; per_base_kobo: number };
export type BatchObs = { dish: string; at: string; expected: number; actual: number; cost_per_expected_plate_kobo: number };
export type WasteObs = { ingredient_id: string; at: string; cost_kobo: number };

export type MarginDiagnosticInput = {
  current: PnlResult; previous: PnlResult;
  currentRange: DateRange; previousRange: DateRange;
  ingredientNames: Map<string, string>;
  /** Base-unit amount of each ingredient in ONE plate of each recipe version. */
  usagePerPlate: Map<string, { ingredient_id: string; base_qty: number }[]>;
  purchases: PriceObs[]; // both periods
  purchaseSpend: { ingredient_id: string; at: string; total_kobo: number }[];
  wastage: WasteObs[];
  batches: BatchObs[];
};

export type DriverItem = { label: string; detail: string; amount_kobo: number };
export type Driver = { key: "ingredients" | "mix" | "wastage"; title: string; points: number; amount_kobo: number; summary: string; items: DriverItem[]; link: "/ingredients" | "/cost-check" | "/wastage"; linkLabel: string };

export type MarginDiagnosticResult = {
  margin_now: number | null; margin_before: number | null; // percent
  change_points: number | null;
  profit_now_kobo: number; profit_before_kobo: number; profit_change_kobo: number;
  sales_now_kobo: number; sales_before_kobo: number;
  direction: "down" | "up" | "flat" | "unknown";
  headline: string;
  drivers: Driver[];
  other_points: number | null;
  notes: string[];
};

const inRange = (at: string, r: DateRange) => { const t = Date.parse(at); return t >= r.from.getTime() && t < r.to.getTime(); };
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
export const round1 = (x: number) => Math.round(x * 10) / 10;
const naira = (kobo: number) => `₦${Math.round(Math.abs(kobo) / 100).toLocaleString("en-NG")}`;
const pts = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(round1(p)).toFixed(1)} points`;

/** Median price per base unit in a period, ignoring entries more than 3× (or under a third of) the median. */
export function robustPrice(obs: number[]): number | null {
  if (!obs.length) return null;
  const m = median(obs);
  const kept = obs.filter((x) => x <= m * OUTLIER_FACTOR && x >= m / OUTLIER_FACTOR);
  return kept.length ? median(kept) : m;
}

const marginPct = (p: PnlResult) => (p.gross_sales_kobo > 0 ? (p.gross_margin_kobo / p.gross_sales_kobo) * 100 : null);

function byName(p: PnlResult) {
  const m = new Map<string, { plates: number; sales: number; cost: number; costed: boolean; versions: string[] }>();
  for (const d of p.by_dish) {
    const x = m.get(d.name) ?? { plates: 0, sales: 0, cost: 0, costed: true, versions: [] };
    x.plates += d.plates; x.sales += d.sales_kobo; x.cost += d.cost_kobo; x.costed &&= d.costed; x.versions.push(d.version_id);
    m.set(d.name, x);
  }
  return m;
}

export function diagnoseMarginChange(input: MarginDiagnosticInput): MarginDiagnosticResult {
  const { current: c, previous: p } = input;
  const R1 = c.gross_sales_kobo, R0 = p.gross_sales_kobo;
  const mu1 = marginPct(c), mu0 = marginPct(p);
  const change = mu1 !== null && mu0 !== null ? mu1 - mu0 : null;
  const notes: string[] = [];
  const drivers: Driver[] = [];

  if (R1 < LOW_DATA_SALES_KOBO || R0 < LOW_DATA_SALES_KOBO || c.paid_orders < LOW_DATA_ORDERS || p.paid_orders < LOW_DATA_ORDERS) {
    notes.push("Too few sales in one of the periods for a reliable comparison. Treat these reasons as rough hints.");
  }
  if ((mu1 !== null && mu1 < 0) || (mu0 !== null && mu0 < 0)) {
    notes.push("Food cost was higher than sales in one period, so the point changes can look extreme.");
  }
  const uncostedSales = c.by_dish.filter((d) => !d.costed).reduce((s, d) => s + d.sales_kobo, 0);
  if (R1 > 0 && uncostedSales > 0) {
    notes.push(`Some dishes can't be costed, so the reasons are based on about ${Math.round((1 - uncostedSales / R1) * 100)}% of this period's sales.`);
  }

  if (R1 > 0 && R0 > 0 && change !== null) {
    // ---- Driver 1: ingredient price rises ----
    const used = new Map<string, number>(); // base units used by plates sold this period
    const dishesUsing = new Map<string, Map<string, number>>();
    for (const d of c.by_dish) {
      for (const u of input.usagePerPlate.get(d.version_id) ?? []) {
        const q = u.base_qty * d.plates;
        used.set(u.ingredient_id, (used.get(u.ingredient_id) ?? 0) + q);
        const m = dishesUsing.get(u.ingredient_id) ?? new Map<string, number>();
        m.set(d.name, (m.get(d.name) ?? 0) + q);
        dishesUsing.set(u.ingredient_id, m);
      }
    }
    const spend1 = new Map<string, number>();
    for (const s of input.purchaseSpend) if (inRange(s.at, input.currentRange)) spend1.set(s.ingredient_id, (spend1.get(s.ingredient_id) ?? 0) + s.total_kobo);
    const ingItems: DriverItem[] = [];
    let ingTotal = 0;
    for (const [ingId, qty] of used) {
      const p1 = robustPrice(input.purchases.filter((x) => x.ingredient_id === ingId && inRange(x.at, input.currentRange)).map((x) => x.per_base_kobo));
      const p0 = robustPrice(input.purchases.filter((x) => x.ingredient_id === ingId && inRange(x.at, input.previousRange)).map((x) => x.per_base_kobo));
      if (p1 === null || p0 === null || p0 <= 0) continue;
      const risePct = ((p1 - p0) / p0) * 100;
      const impact = qty * (p1 - p0);
      if (risePct < PRICE_RISE_MIN_PCT || impact < PRICE_IMPACT_MIN_KOBO || (spend1.get(ingId) ?? 0) < INGREDIENT_SPEND_MIN_KOBO) continue;
      ingTotal += impact;
      const top = [...(dishesUsing.get(ingId) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
      ingItems.push({ label: `${input.ingredientNames.get(ingId) ?? "An ingredient"} (+${Math.round(risePct)}%)`, detail: top.length ? `Used in ${top.join(" and ")}` : "", amount_kobo: impact });
    }
    ingItems.sort((a, b) => b.amount_kobo - a.amount_kobo);
    if (ingItems.length) {
      const pp = -(ingTotal / R1) * 100;
      const names = ingItems.slice(0, 3).map((i) => i.label).join(", ");
      drivers.push({
        key: "ingredients", title: "Ingredient price increases", points: pp, amount_kobo: ingTotal, link: "/ingredients", linkLabel: "View ingredients",
        summary: `You paid more for ${names}. This added about ${naira(ingTotal)} to the cost of the plates you sold.`,
        items: ingItems.slice(0, 3),
      });
    }

    // ---- Driver 2: sales mix (dishes, then channels) ----
    const n1 = byName(c), n0 = byName(p);
    const avg0 = mu0! / 100;
    let mixPts = 0;
    const mixItems: (DriverItem & { effect: number })[] = [];
    for (const [name, d0] of n0) {
      if (!d0.costed || d0.sales <= 0) continue;
      const d1 = n1.get(name);
      const s0 = d0.sales / R0, s1 = (d1?.sales ?? 0) / R1;
      const m0 = (d0.sales - d0.cost) / d0.sales;
      const effect = (s1 - s0) * (m0 - avg0) * 100; // points
      mixPts += effect;
      const shareMove = (s1 - s0) * 100;
      if (Math.abs(shareMove) >= MIX_SHARE_MIN_PP && Math.abs(effect / 100) * R1 >= MIX_IMPACT_MIN_KOBO) {
        const low = m0 < avg0;
        mixItems.push({
          label: name,
          detail: `${low ? "Lower" : "Higher"}-margin dish (${Math.round(m0 * 100)}%): ${Math.round(s0 * 100)}% → ${Math.round(s1 * 100)}% of sales`,
          amount_kobo: (effect / 100) * R1, effect,
        });
      }
    }
    // Channels: walk-in vs everything else (delivery apps, other channels), using last period's margins.
    const ch = (r: PnlResult) => {
      const w = r.by_channel.filter((x) => x.channel.toLowerCase() === "walk-in");
      const o = r.by_channel.filter((x) => x.channel.toLowerCase() !== "walk-in");
      const sum = (xs: typeof w, k: "sales_kobo" | "cost_kobo") => xs.reduce((s, x) => s + x[k], 0);
      return { ws: sum(w, "sales_kobo"), wc: sum(w, "cost_kobo"), os: sum(o, "sales_kobo"), oc: sum(o, "cost_kobo") };
    };
    const c0 = ch(p), c1 = ch(c);
    let chanPts = 0;
    if (c0.ws > 0 && c0.os > 0) {
      const mw = (c0.ws - c0.wc) / c0.ws, mo = (c0.os - c0.oc) / c0.os;
      const dShare = c1.os / R1 - c0.os / R0;
      chanPts = dShare * (mo - mw) * 100;
      if (Math.abs(dShare * 100) >= MIX_SHARE_MIN_PP && Math.abs(chanPts / 100) * R1 >= MIX_IMPACT_MIN_KOBO) {
        mixItems.push({
          label: "Orders not at walk-in",
          detail: `${Math.round((c0.os / R0) * 100)}% → ${Math.round((c1.os / R1) * 100)}% of sales; their margin was ${Math.round(mo * 100)}% vs ${Math.round(mw * 100)}% walk-in`,
          amount_kobo: (chanPts / 100) * R1, effect: chanPts,
        });
      }
    }
    const totalMix = mixPts + chanPts;
    if (mixItems.length) {
      mixItems.sort((a, b) => a.effect - b.effect); // most harmful first
      const hurt = mixItems.filter((i) => i.effect < 0).map((i) => i.label);
      const helped = mixItems.filter((i) => i.effect > 0).map((i) => i.label);
      const summary = totalMix < 0
        ? `You sold more lower-margin dishes and/or fewer higher-margin ones${hurt.length ? ` (${hurt.slice(0, 2).join(", ")})` : ""}.`
        : `Your sales leaned towards higher-margin dishes${helped.length ? ` (${helped.slice(0, 2).join(", ")})` : ""}.`;
      drivers.push({
        key: "mix", title: "What you sold (sales mix)", points: totalMix, amount_kobo: (totalMix / 100) * R1, link: "/cost-check", linkLabel: "Check dish margins",
        summary: `${summary} This moved your margin by about ${pts(totalMix)}.`,
        items: mixItems.slice(0, 4).map(({ effect: _e, ...i }) => i),
      });
    }

    // ---- Driver 3: wastage and batch yield ----
    const dW = c.wastage_cost_kobo - p.wastage_cost_kobo;
    const perIng = (r: DateRange) => {
      const m = new Map<string, number>();
      for (const w of input.wastage) if (inRange(w.at, r)) m.set(w.ingredient_id, (m.get(w.ingredient_id) ?? 0) + w.cost_kobo);
      return m;
    };
    const w1 = perIng(input.currentRange), w0 = perIng(input.previousRange);
    const wasteItems: DriverItem[] = [...new Set([...w1.keys(), ...w0.keys()])]
      .map((id) => ({ id, d: (w1.get(id) ?? 0) - (w0.get(id) ?? 0) }))
      .filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3)
      .map((x) => ({ label: input.ingredientNames.get(x.id) ?? "An ingredient", detail: `${naira(w0.get(x.id) ?? 0)} → ${naira(w1.get(x.id) ?? 0)} wasted`, amount_kobo: x.d }));
    // Yield: per dish, plates made / plates expected. Shown with its rough extra cost; not added to the points
    // (that cost already sits inside batch ingredient spend, not in the P&L food cost).
    const yieldOf = (r: DateRange) => {
      const m = new Map<string, { e: number; a: number; lost: number }>();
      for (const b of input.batches) if (inRange(b.at, r) && b.expected > 0) {
        const x = m.get(b.dish) ?? { e: 0, a: 0, lost: 0 };
        x.e += b.expected; x.a += b.actual; x.lost += Math.max(0, b.expected - b.actual) * b.cost_per_expected_plate_kobo;
        m.set(b.dish, x);
      }
      return m;
    };
    const y1 = yieldOf(input.currentRange), y0 = yieldOf(input.previousRange);
    for (const [dish, a] of y1) {
      const b = y0.get(dish);
      if (!b) continue;
      const r1 = (a.a / a.e) * 100, r0 = (b.a / b.e) * 100;
      if (r0 - r1 >= YIELD_DROP_MIN_PP) wasteItems.push({ label: `${dish} batches`, detail: `Made ${Math.round(r1)}% of expected plates (was ${Math.round(r0)}%)`, amount_kobo: a.lost });
    }
    if (dW !== 0 || wasteItems.length) {
      const pp = -(dW / R1) * 100;
      drivers.push({
        key: "wastage", title: "Wastage & batch yield", points: pp, amount_kobo: dW, link: "/wastage", linkLabel: "Review wastage log",
        summary: `Kitchen wastage was ${naira(c.wastage_cost_kobo)} this period vs ${naira(p.wastage_cost_kobo)} before${dW > 0 ? `, adding about ${naira(dW)} to your costs` : dW < 0 ? `, saving about ${naira(dW)}` : ""}.`,
        items: wasteItems,
      });
    }
  } else if (R1 === 0 || R0 === 0) {
    notes.push("One of the periods has no sales, so there is nothing to compare yet.");
  }

  // Most important first: by size of effect on margin.
  drivers.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const explained = drivers.reduce((s, d) => s + d.points, 0);
  const other = change === null ? null : change - explained;
  const direction = change === null ? "unknown" : Math.abs(change) < 0.5 ? "flat" : change < 0 ? "down" : "up";
  const profit1 = c.gross_margin_kobo, profit0 = p.gross_margin_kobo;
  const dG = profit1 - profit0;
  const headline = change === null
    ? "Not enough sales to compare margins yet."
    : direction === "flat"
      ? `Your margin held steady at about ${Math.round(mu1!)}% (${pts(change)}).`
      : `Your margin ${direction === "down" ? "fell" : "improved"} from ${Math.round(mu0!)}% to ${Math.round(mu1!)}% (${pts(change)}). Profit after food cost ${dG < 0 ? "dropped" : "rose"} by about ${naira(dG)} on ${naira(R1)} sales.`;

  notes.push("This is an estimate based on your recorded sales, costs and wastage. Actual results may differ slightly.");
  return {
    margin_now: mu1, margin_before: mu0, change_points: change,
    profit_now_kobo: profit1, profit_before_kobo: profit0, profit_change_kobo: dG,
    sales_now_kobo: R1, sales_before_kobo: R0,
    direction, headline, drivers, other_points: other, notes,
  };
}

/** Loads everything for two periods and runs the diagnostic. Owner screens only. */
export async function loadMarginDiagnostic(supabase: SupabaseClient, businessId: string, currentRange: DateRange, previousRange: DateRange): Promise<MarginDiagnosticResult> {
  const from = previousRange.from.toISOString();
  const to = currentRange.to.toISOString();
  const [current, previous, ings, convs, recipes, items, purchases, wastage, batches] = await Promise.all([
    calculateBusinessPnl(supabase, businessId, currentRange),
    calculateBusinessPnl(supabase, businessId, previousRange),
    supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").eq("business_id", businessId),
    supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty").eq("business_id", businessId),
    supabase.from("recipes").select("id,name,yield_portions").eq("business_id", businessId),
    supabase.from("recipe_items").select("recipe_id,ingredient_id,quantity,unit").eq("business_id", businessId),
    supabase.from("purchases").select("id,ingredient_id,qty,market_unit,total_kobo,recorded_at,kind,reverses_id,base_qty").eq("business_id", businessId).gte("recorded_at", from).lt("recorded_at", to),
    supabase.from("wastage_logs").select("ingredient_id,cost_kobo,created_at").eq("business_id", businessId).gte("created_at", from).lt("created_at", to),
    supabase.from("batches").select(`id,recipe_id,scale_factor,actual_yield,ingredient_cost_kobo,created_at,${CORRECTION_COLUMNS}`).eq("business_id", businessId).gte("created_at", from).lt("created_at", to),
  ]);
  const ingList: CostIngredient[] = (ings.data ?? []).map((i) => ({ ...i, current_cost_kobo: Number(i.current_cost_kobo) }));
  const convList: CostConversion[] = (convs.data ?? []).map((c) => ({ ...c, base_qty: Number(c.base_qty) }));
  const ingById = new Map(ingList.map((i) => [i.id, i]));
  const recipeById = new Map((recipes.data ?? []).map((r) => [r.id, r]));

  const usagePerPlate = new Map<string, { ingredient_id: string; base_qty: number }[]>();
  for (const it of items.data ?? []) {
    const r = recipeById.get(it.recipe_id); const ing = ingById.get(it.ingredient_id);
    if (!r || !ing || Number(r.yield_portions) <= 0) continue;
    const { base_qty } = toBaseQty(ing, Number(it.quantity), it.unit, convList);
    if (base_qty === null) continue;
    const list = usagePerPlate.get(it.recipe_id) ?? [];
    list.push({ ingredient_id: it.ingredient_id, base_qty: base_qty / Number(r.yield_portions) });
    usagePerPlate.set(it.recipe_id, list);
  }

  const live = purchases.error ? [] : livePurchases(normalisePurchases(purchases.data as unknown[]));
  const priceObs: PriceObs[] = live.filter((x) => (x.base_qty ?? 0) > 0 && x.total_kobo > 0)
    .map((x) => ({ ingredient_id: x.ingredient_id, at: x.recorded_at, per_base_kobo: x.total_kobo / Number(x.base_qty) }));

  type B = Correctable & { recipe_id: string; scale_factor: number; actual_yield: number | null; ingredient_cost_kobo: number };
  const batchRows = batches.error ? [] : standingEntries((batches.data ?? []) as unknown as B[]);
  const batchObs: BatchObs[] = batchRows.flatMap((b) => {
    const r = recipeById.get(b.recipe_id);
    if (!r || b.actual_yield === null) return [];
    const expected = Number(b.scale_factor) * Number(r.yield_portions);
    return [{ dish: r.name, at: b.created_at, expected, actual: Number(b.actual_yield), cost_per_expected_plate_kobo: expected > 0 ? Number(b.ingredient_cost_kobo) / expected : 0 }];
  });

  return diagnoseMarginChange({
    current, previous, currentRange, previousRange,
    ingredientNames: new Map(ingList.map((i) => [i.id, i.name])),
    usagePerPlate,
    purchases: priceObs,
    purchaseSpend: live.map((x) => ({ ingredient_id: x.ingredient_id, at: x.recorded_at, total_kobo: x.total_kobo })),
    wastage: (wastage.data ?? []).map((w) => ({ ingredient_id: w.ingredient_id, at: w.created_at, cost_kobo: Number(w.cost_kobo) })),
    batches: batchObs,
  });
}
