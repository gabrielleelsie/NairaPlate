import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { calculateBusinessPnl } from "./pnl";

// A tiny stand-in for the database client: a table's rows come back; ".in(column, values)" drops rows that have that column with another value.
function fake(tables: Record<string, unknown[]>): SupabaseClient {
  return {
    from(t: string) {
      let rows = [...(tables[t] ?? [])] as Record<string, unknown>[];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "lt", "lte", "order", "limit"]) q[m] = () => q;
      q["in"] = (col: string, vals: unknown[]) => { rows = rows.filter((r) => !(col in r) || vals.includes(r[col])); return q; };
      q["then"] = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: { message: "no price history in this test" } }),
  } as unknown as SupabaseClient;
}

const line = (price: number, cost: number) => ({ recipe_id: "r1", recipe_version_id: "r1", quantity: 1, unit_price_kobo: price, cost_per_plate_kobo: cost });
const order = (id: string, status: string, total: number, cash: number, transfer: number) => ({
  id, status, total_kobo: total, cash_amount_kobo: cash, transfer_amount_kobo: transfer, created_at: "2026-10-02T10:00:00Z", channel: "walk_in", order_items: [line(total, 30000)],
});
const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-04T00:00:00Z") };
const base = { recipes: [{ id: "r1", name: "Jollof", yield_portions: 1, cost_grade: null }] };

describe("profit report with a transfer-lost paper sale", () => {
  it("counts only the cash kept as sales and the full food cost, and says so", async () => {
    const r = await calculateBusinessPnl(fake({ ...base, orders: [order("o1", "paid", 100000, 100000, 0), order("o2", "transfer_lost", 100000, 40000, 60000), order("o3", "cancelled", 100000, 100000, 0)] }), "b1", range);
    expect(r.gross_sales_kobo).toBe(100000 + 40000); // the voided sale counts nothing; the lost transfer is not sales
    expect(r.recipe_cost_of_goods_kobo).toBe(60000); // both served sales cost their full 30000
    expect(r.gross_margin_kobo).toBe(140000 - 60000);
    expect(r.warnings.join(" ")).toMatch(/1 paper sale had a transfer that never arrived/);
    expect(r.warnings.join(" ")).toMatch(/₦400\.00/);
    expect(r.warnings.join(" ")).toMatch(/₦600\.00/);
  });
  it("adds no warning and changes nothing when there is no such sale", async () => {
    const r = await calculateBusinessPnl(fake({ ...base, orders: [order("o1", "paid", 100000, 100000, 0)] }), "b1", range);
    expect(r.gross_sales_kobo).toBe(100000);
    expect(r.warnings.join(" ")).not.toMatch(/never arrived/);
  });
  it("still takes part refunds off a normal order", async () => {
    const r = await calculateBusinessPnl(fake({ ...base, orders: [order("o1", "partially_refunded", 100000, 100000, 0)], order_adjustments: [{ order_id: "o1", adjustment_amount_kobo: 20000 }] }), "b1", range);
    expect(r.gross_sales_kobo).toBe(80000);
  });
});
