import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { adjustedCount, adjustedDiscrepancy, adjustmentDelta, canAdjust, canForceClose, expectedDrawerCash, normaliseShifts, reasonOk, shiftLabel, sumKobo, type ShiftAdjustment, type ShiftRow } from "./cash-drawer";

// A tiny stand-in for the database client. The table's rows come back; a filter only removes a row when the row has that field,
// so older tests (rows with just the amounts) are unaffected. ".or(...)" is the "not a paper sale" rule: rows marked is_late_entry are dropped.
function fake(tables: Record<string, unknown[]>, failing: string[] = []): SupabaseClient {
  return {
    from(t: string) {
      let rows = [...(tables[t] ?? [])] as Record<string, unknown>[];
      const q: Record<string, unknown> = {};
      q["select"] = () => q;
      q["gte"] = () => q;
      q["lte"] = () => q;
      q["eq"] = (col: string, val: unknown) => { rows = rows.filter((r) => !(col in r) || r[col] === val); return q; };
      q["in"] = (col: string, vals: unknown[]) => { rows = rows.filter((r) => !(col in r) || vals.includes(r[col])); return q; };
      q["or"] = () => { rows = rows.filter((r) => r["is_late_entry"] !== true); return q; };
      q["then"] = (res: (v: unknown) => unknown) => Promise.resolve(failing.includes(t) ? { data: null, error: { message: "x" } } : { data: rows, error: null }).then(res);
      return q;
    },
  } as unknown as SupabaseClient;
}
const drawer = { id: "d1", business_id: "b1", opening_float_kobo: 200000, opened_at: "2026-10-01T08:00:00Z" };

describe("expectedDrawerCash", () => {
  it("is the float plus cash sales when nothing else was collected", async () => {
    const r = await expectedDrawerCash(fake({ orders: [{ id: "o1", cash_amount_kobo: 300000 }, { id: "o2", cash_amount_kobo: 100000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r).toEqual({ cash_sales_kobo: 400000, catering_cash_kobo: 0, debt_cash_kobo: 0, payouts_kobo: 0, expected_cash_kobo: 600000 });
  });
  it("adds cash catering payments and cash debt payments", async () => {
    const r = await expectedDrawerCash(fake({ orders: [{ id: "o1", cash_amount_kobo: 100000 }], catering_payments: [{ amount_kobo: 50000 }], credit_payments: [{ amount_kobo: 25000 }, { amount_kobo: 5000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.catering_cash_kobo).toBe(50000); expect(r.debt_cash_kobo).toBe(30000); expect(r.expected_cash_kobo).toBe(200000 + 100000 + 50000 + 30000);
  });
  it("nets a reversal against the payment it undid", async () => {
    const r = await expectedDrawerCash(fake({ catering_payments: [{ amount_kobo: 50000 }, { amount_kobo: -50000 }], credit_payments: [{ amount_kobo: 40000 }, { amount_kobo: -40000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.catering_cash_kobo).toBe(0); expect(r.debt_cash_kobo).toBe(0); expect(r.expected_cash_kobo).toBe(200000);
  });
  it("takes a part refund off the cash taken, never below zero", async () => {
    const r = await expectedDrawerCash(fake({ orders: [{ id: "o1", cash_amount_kobo: 100000 }, { id: "o2", cash_amount_kobo: 20000 }],
      order_adjustments: [{ order_id: "o1", adjustment_amount_kobo: 30000 }, { order_id: "o2", adjustment_amount_kobo: 50000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.cash_sales_kobo).toBe(70000);
  });
  it("refuses to give an answer when cash collections cannot be read", async () => {
    await expect(expectedDrawerCash(fake({}, ["catering_payments"]), drawer, "2026-10-01T20:00:00Z")).rejects.toThrow("Could not read cash collections.");
    await expect(expectedDrawerCash(fake({}, ["credit_payments"]), drawer, "2026-10-01T20:00:00Z")).rejects.toThrow();
  });
  it("takes cash paid out of the drawer off the expected cash, and counts a reversal as cash put back", async () => {
    const r = await expectedDrawerCash(fake({ orders: [{ id: "o1", cash_amount_kobo: 500000 }],
      cash_drawer_payouts: [{ amount_kobo: 300000 }, { amount_kobo: 200000 }, { amount_kobo: -200000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.payouts_kobo).toBe(300000); expect(r.expected_cash_kobo).toBe(200000 + 500000 - 300000);
  });
  it("lets an honest market run leave the drawer balanced", async () => {
    // float 2,000 + cash sale 5,000 - market run 3,000 = 4,000 expected; the cashier counts 4,000: no shortage
    const r = await expectedDrawerCash(fake({ orders: [{ id: "o1", cash_amount_kobo: 500000 }], cash_drawer_payouts: [{ amount_kobo: 300000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.expected_cash_kobo).toBe(400000);
  });
  it("counts a cash catering deposit once it carries a cash method (it is a catering payment like the others)", async () => {
    const r = await expectedDrawerCash(fake({ catering_payments: [{ amount_kobo: 100000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.catering_cash_kobo).toBe(100000); expect(r.expected_cash_kobo).toBe(300000);
  });
  it("refuses to give an answer when cash payouts cannot be read", async () => {
    await expect(expectedDrawerCash(fake({}, ["cash_drawer_payouts"]), drawer, "2026-10-01T20:00:00Z")).rejects.toThrow("Could not read cash payouts.");
  });
  // Paper (late) sales: counted by the shift they really happened in, never by when they were approved.
  const paperOrder = (o: Record<string, unknown> = {}) => ({ id: "p1", cash_amount_kobo: 150000, is_late_entry: true, status: "paid", payment_method: "cash", ...o });
  const paperEntry = (o: Record<string, unknown> = {}) => ({ posted_order_id: "p1", source_shift_id: "d1", status: "posted", shift_resolution: "open_shift_direct", ...o });
  it("counts a paper sale posted straight to this shift, once", async () => {
    const r = await expectedDrawerCash(fake({ orders: [paperOrder()], late_entries: [paperEntry()] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.cash_sales_kobo).toBe(150000); expect(r.expected_cash_kobo).toBe(350000);
  });
  it("does not count a paper sale just because it was approved while this shift was open", async () => {
    // its real shift was another one (closed): the cash is already in that shift's count or an adjustment
    const r = await expectedDrawerCash(fake({ orders: [paperOrder()], late_entries: [paperEntry({ source_shift_id: "d0", shift_resolution: "closed_shift_included" })] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.cash_sales_kobo).toBe(0);
  });
  it("does not count cash that belongs to no shift (outside_shift_cash), nor late cash added to a closed shift", async () => {
    for (const res of ["outside_shift_cash", "closed_shift_late_cash"]) {
      const r = await expectedDrawerCash(fake({ orders: [paperOrder()], late_entries: [paperEntry({ shift_resolution: res })] }), drawer, "2026-10-01T20:00:00Z");
      expect(r.cash_sales_kobo).toBe(0);
    }
  });
  it("counts the cash part of a split paper sale that still waits for its transfer", async () => {
    const r = await expectedDrawerCash(fake({ orders: [paperOrder({ cash_amount_kobo: 50000, status: "awaiting_payment", payment_method: "split" })], late_entries: [paperEntry()] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.cash_sales_kobo).toBe(50000);
  });
  it("does not count a cancelled paper sale", async () => {
    const r = await expectedDrawerCash(fake({ orders: [paperOrder({ status: "cancelled" })], late_entries: [paperEntry()] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.cash_sales_kobo).toBe(0);
  });
  it("takes a part refund off a paper sale's cash too, and adds it to till sales", async () => {
    const r = await expectedDrawerCash(fake({ orders: [{ id: "o1", cash_amount_kobo: 100000 }, paperOrder({ status: "partially_refunded" })], late_entries: [paperEntry()],
      order_adjustments: [{ order_id: "p1", adjustment_amount_kobo: 40000 }] }), drawer, "2026-10-01T20:00:00Z");
    expect(r.cash_sales_kobo).toBe(100000 + 110000);
  });
  it("refuses to give an answer when paper sales cannot be read", async () => {
    await expect(expectedDrawerCash(fake({}, ["late_entries"]), drawer, "2026-10-01T20:00:00Z")).rejects.toThrow("Could not read paper sales.");
  });
  it("sumKobo copes with nothing and with text numbers", () => { expect(sumKobo(null)).toBe(0); expect(sumKobo([{ amount_kobo: "5" }, { amount_kobo: 7 }])).toBe(12); });
});

const shift = (o: Partial<ShiftRow> = {}): ShiftRow => ({
  id: "s1", status: "closed", opened_at: "2026-10-01T08:00:00Z", closed_at: "2026-10-01T20:00:00Z", opened_by_name: "Ada", closed_by_name: "Ada", opening_float_kobo: 500000,
  closing_counted_kobo: 530000, expected_cash_kobo: 550000, discrepancy_kobo: -20000, cash_sales_kobo: 50000, catering_cash_kobo: 0, debt_cash_kobo: 0, payouts_kobo: null, forced: false, close_reason: null, ...o,
});
const adj = (o: Partial<ShiftAdjustment>): ShiftAdjustment => ({ id: "a1", drawer_id: "s1", amount_kobo: 0, reason: "typo", recorded_by_name: "Owner", created_at: "2026-10-02T08:00:00Z", ...o });

describe("count adjustments", () => {
  it("keeps the original count and adds the adjustments", () => {
    const rows = [adj({ amount_kobo: 20000 }), adj({ id: "a2", amount_kobo: -5000 }), adj({ id: "a3", drawer_id: "other", amount_kobo: 999 })];
    expect(adjustedCount(shift(), rows)).toBe(545000);
    expect(adjustedDiscrepancy(shift(), rows)).toBe(-5000);
    expect(shift().closing_counted_kobo).toBe(530000);
  });
  it("has no adjusted figures for a shift closed without a count", () => {
    const s = shift({ closing_counted_kobo: null, discrepancy_kobo: null });
    expect(adjustedCount(s, [])).toBeNull(); expect(adjustedDiscrepancy(s, [])).toBeNull(); expect(adjustmentDelta(100, s, [])).toBeNull();
  });
  it("works out what to add so the count becomes the correct figure", () => {
    expect(adjustmentDelta(550000, shift(), [])).toBe(20000);
    expect(adjustmentDelta(550000, shift(), [adj({ amount_kobo: 20000 })])).toBe(0);
    expect(adjustmentDelta(500000, shift(), [adj({ amount_kobo: 20000 })])).toBe(-50000);
  });
  it("refuses a negative or invalid correct count", () => { expect(adjustmentDelta(-1, shift(), [])).toBeNull(); expect(adjustmentDelta(Number.NaN, shift(), [])).toBeNull(); });
});

describe("who can do what", () => {
  it("only owners adjust a closed shift that has a count", () => {
    expect(canAdjust(shift(), "owner")).toBe(true); expect(canAdjust(shift(), "supa_admin")).toBe(true);
    expect(canAdjust(shift(), "cashier")).toBe(false); expect(canAdjust(shift({ status: "open" }), "owner")).toBe(false);
    expect(canAdjust(shift({ closing_counted_kobo: null }), "owner")).toBe(false);
  });
  it("only owners force-close, and only an open shift", () => {
    expect(canForceClose({ status: "open" }, "owner")).toBe(true); expect(canForceClose({ status: "open" }, "cashier")).toBe(false); expect(canForceClose({ status: "closed" }, "owner")).toBe(false);
  });
  it("needs a reason of 5 or more characters", () => { expect(reasonOk("abcd")).toBe(false); expect(reasonOk(" abcde ")).toBe(true); });
});

describe("labels and reading rows", () => {
  it("names each kind of shift", () => {
    expect(shiftLabel(shift({ status: "open" }))).toBe("Open"); expect(shiftLabel(shift())).toBe("Closed");
    expect(shiftLabel(shift({ forced: true }))).toBe("Closed by owner");
    expect(shiftLabel(shift({ forced: true, closing_counted_kobo: null }))).toBe("Closed by owner, not counted");
  });
  it("reads numbers and keeps missing counts missing", () => {
    const r = normaliseShifts([{ ...shift(), opening_float_kobo: "500000", closing_counted_kobo: null, expected_cash_kobo: "100", forced: null }])[0]!;
    expect(r.opening_float_kobo).toBe(500000); expect(r.closing_counted_kobo).toBeNull(); expect(r.expected_cash_kobo).toBe(100); expect(r.forced).toBe(false);
  });
});
