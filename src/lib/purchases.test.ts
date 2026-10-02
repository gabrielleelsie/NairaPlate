import { describe, expect, it } from "vitest";
import { describePurchases, livePurchases, NEWER_PRICE_MESSAGE, OLD_PURCHASE_MESSAGE, normalisePurchases, reasonOk, reversalPreview, reverseBlocked, type PurchaseRow } from "./purchases";

const T1 = "2026-10-02T10:00:00.123456+00:00";
const row = (o: Partial<PurchaseRow> = {}): PurchaseRow => ({
  id: "p1", ingredient_id: "i1", qty: 20, market_unit: "kg", total_kobo: 3000000, payment_method: "credit", recorded_at: T1, grade: "A", season: "scarce",
  kind: "purchase", reverses_id: null, base_qty: 20, price_set_at: T1, before_state: { cost_kobo: 145000, grade: "B", season: "normal" }, supplier_id: "s1", ...o,
});
const rev = (o: Partial<PurchaseRow> = {}): PurchaseRow => row({ id: "r1", kind: "reversal", reverses_id: "p1", qty: -20, total_kobo: -3000000, base_qty: -20, reason: "wrong quantity", price_set_at: null, before_state: null, ...o });
const ing = { price_updated_at: "2026-10-02T10:00:00.123Z", stock_base_qty: 30, base_unit: "kg", name: "Rice" };
const view = (r: PurchaseRow, others: PurchaseRow[] = []) => describePurchases([r, ...others])[0]!;

describe("describePurchases", () => {
  it("marks a reversed purchase and its reversal", () => {
    const v = describePurchases([rev(), row()]);
    expect(v[0]!.isReversal).toBe(true);
    expect(v[1]!.reversed).toBe(true); expect(v[1]!.reversedByReason).toBe("wrong quantity");
  });
  it("leaves an untouched purchase alone", () => expect(view(row()).reversed).toBe(false));
});

describe("livePurchases", () => {
  it("drops reversals and what they reversed, so averages are not skewed", () => {
    const rows = [rev(), row(), row({ id: "p2", qty: 5, total_kobo: 900000 })];
    expect(livePurchases(rows).map((r) => r.id)).toEqual(["p2"]);
  });
});

describe("reverseBlocked", () => {
  it("allows an owner when nothing has changed the price since", () => expect(reverseBlocked(view(row()), ing, "owner")).toBeNull());
  it("allows supa_admin", () => expect(reverseBlocked(view(row()), ing, "supa_admin")).toBeNull());
  it("refuses purchasers, cashiers and signed-out", () => {
    for (const r of ["purchaser", "cashier", "cook", null]) expect(reverseBlocked(view(row()), ing, r)).toBe("Only an owner can reverse a purchase.");
  });
  it("refuses when the ingredient price was changed later", () => {
    expect(reverseBlocked(view(row()), { ...ing, price_updated_at: "2026-10-02T11:00:00Z" }, "owner")).toBe(NEWER_PRICE_MESSAGE);
  });
  it("refuses when the ingredient is not loaded or has no price time", () => {
    expect(reverseBlocked(view(row()), undefined, "owner")).toBe(NEWER_PRICE_MESSAGE);
    expect(reverseBlocked(view(row()), { ...ing, price_updated_at: null }, "owner")).toBe(NEWER_PRICE_MESSAGE);
  });
  it("refuses a purchase with no saved snapshot", () => {
    expect(reverseBlocked(view(row({ price_set_at: null, before_state: null, base_qty: null })), ing, "owner")).toBe(OLD_PURCHASE_MESSAGE);
  });
  it("refuses one already reversed, and a reversal", () => {
    expect(reverseBlocked(view(row(), [rev()]), ing, "owner")).toBe("Already reversed.");
    expect(reverseBlocked(view(rev()), ing, "owner")).toMatch(/cannot be reversed/);
  });
});

describe("reversalPreview", () => {
  it("shows the price going back and the stock after", () => {
    const p = reversalPreview(row(), ing, 3000000);
    expect(p.priceBackKobo).toBe(145000); expect(p.stockAfter).toBe(10); expect(p.belowZero).toBe(false);
    expect(p.supplierBalanceAfterKobo).toBe(0); expect(p.supplierOwesYouKobo).toBe(0);
  });
  it("warns when stock goes below zero", () => {
    const p = reversalPreview(row(), { ...ing, stock_base_qty: 5 }, null);
    expect(p.stockAfter).toBe(-15); expect(p.belowZero).toBe(true); expect(p.supplierBalanceAfterKobo).toBeNull();
  });
  it("warns when the supplier would owe you, after a part payment", () => {
    // owed 1,000 after a payment of 800 on a purchase of 1,000 and nothing else
    const p = reversalPreview(row({ total_kobo: 100000 }), ing, 20000);
    expect(p.supplierBalanceAfterKobo).toBe(-80000); expect(p.supplierOwesYouKobo).toBe(80000);
  });
  it("handles a cash purchase (no supplier balance)", () => expect(reversalPreview(row({ payment_method: "cash", supplier_id: null }), ing, null).supplierOwesYouKobo).toBe(0));
});

describe("normalise and reason", () => {
  it("reads numbers from text columns", () => {
    const r = normalisePurchases([{ ...row(), qty: "20", total_kobo: "3000000", base_qty: "20" }])[0]!;
    expect(r.qty).toBe(20); expect(r.total_kobo).toBe(3000000); expect(r.base_qty).toBe(20);
  });
  it("needs a reason of 5 or more characters", () => { expect(reasonOk("abcd")).toBe(false); expect(reasonOk(" abcde ")).toBe(true); });
});
