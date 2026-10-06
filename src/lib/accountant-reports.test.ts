import { describe, expect, it } from "vitest";
import { ageBalance, buildSalesDayBook, buildPayoutRegister, buildSupplierLedger, buildCustomerLedger, buildBatchProduction, buildRefundRegister, costConfidence, type Range } from "./accountant-reports";
import { REPORT_SCHEMAS } from "./csv-export";

const range: Range = { fromKey: "2026-10-01", toKey: "2026-10-05", fromIso: "2026-09-30T23:00:00.000Z", toIso: "2026-10-05T23:00:00.000Z" };

describe("accountant reports", () => {
  it("ages newest charges first", () => {
    const a = ageBalance(15000, [{ dateKey: "2026-06-01", kobo: 10000 }, { dateKey: "2026-09-20", kobo: 10000 }], "2026-10-05");
    expect(a).toEqual({ d0_30: 10000, d31_60: 0, d61_90: 0, d90: 5000 });
    expect(ageBalance(-500, [], "2026-10-05").d90).toBe(0);
  });
  it("labels cost confidence from stored labels only", () => {
    expect(costConfidence(false, [])).toBe("snapshot");
    expect(costConfidence(true, ["sale_time_exact"])).toBe("high");
    expect(costConfidence(true, ["sale_time_exact", "sale_time_backfilled"])).toBe("medium");
    expect(costConfidence(true, ["estimated_current_price"])).toBe("low");
  });
  it("builds the sales day book with refunds taken off", () => {
    const rows = buildSalesDayBook([
      { id: "aaaaaaaa-1", subtotal_kobo: 300000, total_kobo: 300000, status: "partially_refunded", payment_method: "cash", channel: "walk_in", created_by: "u1", created_at: "2026-10-02T10:00:00Z" },
      { id: "bbbbbbbb-2", subtotal_kobo: 100000, total_kobo: 100000, status: "cancelled", payment_method: "cash", channel: null, created_by: null, created_at: "2026-10-02T09:00:00Z" },
    ], [{ id: "x", order_id: "aaaaaaaa-1", type: "partial_refund", adjustment_amount_kobo: 50000, created_at: "2026-10-02T11:00:00Z" }], new Map(), new Map([["u1", "Ada"]]));
    expect(rows[0]!["status"]).toBe("voided");
    expect(rows[0]!["net_sales_naira"]).toBe("0.00");
    expect(rows[1]!["net_sales_kobo"]).toBe("250000");
    expect(rows[1]!["cashier_name"]).toBe("Ada");
    expect(Object.keys(rows[1]!).sort()).toEqual([...REPORT_SCHEMAS.sales_day_book.columns].sort());
  });
  it("shows a transfer-lost paper sale's unpaid transfer on its own and counts only the cash kept as net sales", () => {
    const rows = buildSalesDayBook([
      { id: "cccccccc-3", subtotal_kobo: 100000, total_kobo: 100000, cash_amount_kobo: 40000, transfer_amount_kobo: 60000, status: "transfer_lost", payment_method: "split", channel: "walk_in", created_by: null, created_at: "2026-10-02T12:00:00Z", is_late_entry: true },
      { id: "dddddddd-4", subtotal_kobo: 50000, total_kobo: 50000, cash_amount_kobo: 50000, transfer_amount_kobo: 0, status: "paid", payment_method: "cash", channel: "walk_in", created_by: null, created_at: "2026-10-02T13:00:00Z" },
    ], [], new Map(), new Map());
    expect(rows[0]!["status"]).toBe("transfer_lost");
    expect(rows[0]!["gross_sales_naira"]).toBe("1000.00");
    expect(rows[0]!["lost_transfer_naira"]).toBe("600.00");
    expect(rows[0]!["net_sales_naira"]).toBe("400.00");
    expect(rows[0]!["net_sales_kobo"]).toBe("40000");
    expect(rows[1]!["lost_transfer_naira"]).toBe("0.00");
    expect(rows[1]!["net_sales_kobo"]).toBe("50000");
    expect(REPORT_SCHEMAS.sales_day_book.version).toBe("sales_day_book_v3");
  });
  it("receipt columns: late entries counted, till sales FALSE/0, unknown stays blank", () => {
    const o = (id: string, late: boolean, t: string) => ({ id, subtotal_kobo: 1000, total_kobo: 1000, status: "completed", payment_method: "cash", channel: null, created_by: null, created_at: t, is_late_entry: late });
    const orders = [o("till", false, "2026-10-02T08:00:00Z"), o("le0", true, "2026-10-02T09:00:00Z"), o("le1", true, "2026-10-02T10:00:00Z"), o("le2", true, "2026-10-02T11:00:00Z")];
    const rows = buildSalesDayBook(orders, [], new Map(), new Map(), new Map([["le1", 1], ["le2", 2]]));
    expect(rows.map((r) => [r["receipt_attached"], r["receipt_count"]])).toEqual([[false, 0], [false, 0], [true, 1], [true, 2]]);
    const unknown = buildSalesDayBook(orders, [], new Map(), new Map(), null);
    expect(unknown.map((r) => r["receipt_count"])).toEqual([0, "", "", ""]);
    expect(Object.keys(rows[0]!)).toEqual([...REPORT_SCHEMAS.sales_day_book.columns]);
  });
  it("payout register receipt columns", () => {
    const p = (id: string, t: string) => ({ id, drawer_id: "d", kind: "payout" as const, amount_kobo: 500, category: "gas", note: "", reverses_id: null, approves_id: null, purchase_id: null, supplier_txn_id: null, recorded_by: null, recorded_by_role: null, recorded_by_name: null, created_at: t });
    const rows = buildPayoutRegister([p("a", "2026-10-02T08:00:00Z"), p("b", "2026-10-02T09:00:00Z")], new Map([["b", 1]]));
    expect(rows.map((r) => [r["receipt_attached"], r["receipt_count"]])).toEqual([[false, 0], [true, 1]]);
    expect(buildPayoutRegister([p("a", "2026-10-02T08:00:00Z")], null)[0]!["receipt_attached"]).toBe("");
    expect(Object.keys(rows[0]!)).toEqual([...REPORT_SCHEMAS.cash_paid_out_register.columns]);
  });
  it("supplier ledger opening + window = closing", () => {
    const rows = buildSupplierLedger([{ id: "s1", name: "Iya Basira", phone: null }], [
      { id: "1", supplier_id: "s1", type: "purchase_on_credit", amount_kobo: 100000, purchase_id: null, note: null, created_at: "2026-09-10T10:00:00Z" },
      { id: "2", supplier_id: "s1", type: "payment", amount_kobo: 40000, purchase_id: null, note: null, created_at: "2026-10-02T10:00:00Z" },
      { id: "3", supplier_id: "s1", type: "purchase_on_credit", amount_kobo: 999, purchase_id: null, note: null, created_at: "2026-10-09T10:00:00Z" },
    ], range);
    expect(rows[0]).toMatchObject({ opening_balance_naira: "1000.00", payments_made_naira: "400.00", closing_balance_kobo: "60000", balance_0_30_days_naira: "600.00" });
  });
  it("customer ledger nets reversals against the right kind", () => {
    const rows = buildCustomerLedger([{ id: "c1", customer_name: "Tunde", phone: null, amount_kobo: 100000, created_at: "2026-10-01T10:00:00Z" }], [
      { id: "p1", credit_id: "c1", kind: "payment", amount_kobo: 30000, reverses_id: null, created_at: "2026-10-02T10:00:00Z" },
      { id: "r1", credit_id: "c1", kind: "reversal", amount_kobo: -30000, reverses_id: "p1", created_at: "2026-10-03T10:00:00Z" },
      { id: "w1", credit_id: "c1", kind: "write_off", amount_kobo: 10000, reverses_id: null, created_at: "2026-10-03T11:00:00Z" },
    ], range);
    expect(rows[0]).toMatchObject({ total_payments_naira: "0.00", total_writeoffs_naira: "100.00", balance_owed_kobo: "90000", status: "owing" });
  });
  it("marks reversed batches and per-plate cost", () => {
    const rows = buildBatchProduction([{ id: "b1", recipe_id: "r", actual_yield: 10, ingredient_cost_kobo: 80000, packaging_kobo: 10000, utilities_kobo: 10000, created_at: "2026-10-02T10:00:00Z" }],
      new Map([["r", { name: "Jollof", yield_portions: 12 }]]), [{ id: "b2", recipe_id: "r", actual_yield: 10, ingredient_cost_kobo: 0, packaging_kobo: 0, utilities_kobo: 0, created_at: "2026-10-03T10:00:00Z", kind: "reversal", reverses_id: "b1", reason: "wrong pot" }]);
    expect(rows[0]).toMatchObject({ realized_cost_per_plate_naira: "100.00", reversal_status: "reversed", reversal_reason: "wrong pot", cost_source: "snapshot" });
  });
  it("shows remaining refundable on partial refunds", () => {
    const p = { id: "a1", order_id: "o1", type: "partial_refund", adjustment_amount_kobo: 20000, created_at: "2026-10-02T10:00:00Z" };
    const rows = buildRefundRegister({ orderAdjs: [p], allPartials: [p], orderTotals: new Map([["o1", 50000]]), names: new Map(), supplier: [], payouts: [], credit: [], batches: [] });
    expect(rows[0]).toMatchObject({ module: "Till Sales", remaining_refundable_naira: "300.00", reversed_record_id: "o1" });
  });
});
