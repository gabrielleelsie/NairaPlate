import { describe, expect, it } from "vitest";
import { PAYMENT_METHODS, TXN_COLUMNS, advanceWarning, balanceWords, canReverse, methodLabel, methodProblem, reasonOk, reversalOf, signedAmount, supplierBalance, withRunningBalance, type SupplierTxn } from "@/lib/suppliers";

const t = (o: Partial<SupplierTxn> & Pick<SupplierTxn, "id" | "type" | "amount_kobo" | "created_at">): SupplierTxn =>
  ({ supplier_id: "s1", purchase_id: null, note: null, ...o });

const txns = [
  t({ id: "c", type: "purchase_on_credit", amount_kobo: 1000000, created_at: "2026-10-01T10:00:00Z" }),
  t({ id: "p1", type: "payment", amount_kobo: 300000, created_at: "2026-10-02T10:00:00Z" }),
  t({ id: "p2", type: "payment", amount_kobo: 900000, created_at: "2026-10-03T10:00:00Z" }),
  t({ id: "r", type: "reversal", amount_kobo: 900000, reverses_id: "p2", reason: "paid the wrong supplier", created_at: "2026-10-03T11:00:00Z" }),
];

describe("balance owed", () => {
  it("adds credit purchases, takes off payments, and puts a reversed payment back", () => {
    expect(signedAmount(txns[0]!)).toBe(1000000);
    expect(signedAmount(txns[1]!)).toBe(-300000);
    expect(signedAmount(txns[3]!)).toBe(900000);
    expect(supplierBalance(txns, "s1")).toBe(700000);
  });
  it("goes negative when an advance is paid (the supplier owes you)", () => {
    expect(supplierBalance(txns.slice(0, 3), "s1")).toBe(-200000);
  });
  it("ignores other suppliers", () => {
    expect(supplierBalance(txns, "other")).toBe(0);
  });
  it("shows the balance after each line, newest first", () => {
    const lines = withRunningBalance(txns);
    expect(lines.map((l) => l.id)).toEqual(["r", "p2", "p1", "c"]);
    expect(lines.map((l) => l.balance_after)).toEqual([700000, -200000, 700000, 1000000]);
  });
});

describe("reversals", () => {
  const undone = reversalOf(txns);
  it("finds which payments were undone", () => {
    expect(undone.has("p2")).toBe(true);
    expect(undone.get("p2")?.reason).toBe("paid the wrong supplier");
    expect(undone.has("p1")).toBe(false);
  });
  it("lets an owner reverse a live payment, nobody else, never twice, never a credit or a reversal", () => {
    expect(canReverse(txns[1]!, "owner", undone)).toBe(true);
    expect(canReverse(txns[1]!, "purchaser", undone)).toBe(false);
    expect(canReverse(txns[2]!, "owner", undone)).toBe(false);
    expect(canReverse(txns[0]!, "owner", undone)).toBe(false);
    expect(canReverse(txns[3]!, "owner", undone)).toBe(false);
  });
  it("needs a reason of 5 or more characters", () => {
    expect(reasonOk("oops")).toBe(false);
    expect(reasonOk("paid wrong supplier")).toBe(true);
  });
});

describe("advance warning", () => {
  it("warns only when the payment is more than what is owed", () => {
    expect(advanceWarning(500000, 500000)).toBeNull();
    expect(advanceWarning(500000, 200000)).toBeNull();
    expect(advanceWarning(500000, 700000)).toEqual({ extraKobo: 200000 });
  });
  it("warns on any payment when nothing is owed, or the supplier already owes you", () => {
    expect(advanceWarning(0, 100000)).toEqual({ extraKobo: 100000 });
    expect(advanceWarning(-300000, 100000)).toEqual({ extraKobo: 100000 });
  });
  it("does not warn for no amount", () => {
    expect(advanceWarning(500000, 0)).toBeNull();
    expect(advanceWarning(500000, Number.NaN)).toBeNull();
  });
});

describe("balanceWords", () => {
  const f = (k: number) => `N${k / 100}`;
  it("says who owes whom", () => {
    expect(balanceWords(700000, f)).toBe("You owe them N7000");
    expect(balanceWords(-200000, f)).toBe("They owe you N2000");
    expect(balanceWords(0, f)).toBe("You owe them nothing");
  });
});

describe("reversed credit purchases", () => {
  const t = (o: Partial<SupplierTxn>): SupplierTxn => ({ id: "x", supplier_id: "s1", type: "purchase_on_credit", amount_kobo: 0, purchase_id: null, note: null, created_at: "2026-10-01T10:00:00Z", ...o });
  it("takes a reversed credit purchase off what is owed", () => {
    const rows = [t({ id: "a", amount_kobo: 100000 }), t({ id: "b", type: "purchase_reversal", amount_kobo: 100000, reverses_id: "a", reason: "wrong invoice", created_at: "2026-10-01T11:00:00Z" })];
    expect(supplierBalance(rows, "s1")).toBe(0);
    expect(reversalOf(rows).get("a")?.id).toBe("b");
  });
  it("leaves the supplier owing you after a part payment and a reversal", () => {
    const rows = [t({ id: "a", amount_kobo: 100000 }), t({ id: "p", type: "payment", amount_kobo: 80000, created_at: "2026-10-01T10:30:00Z" }),
      t({ id: "b", type: "purchase_reversal", amount_kobo: 100000, reverses_id: "a", created_at: "2026-10-01T11:00:00Z" })];
    expect(supplierBalance(rows, "s1")).toBe(-80000);
  });
});

describe("payment method", () => {
  it("offers four ways to pay and never offers legacy", () => {
    expect(PAYMENT_METHODS.map((m) => m.value)).toEqual(["cash_from_drawer", "cash_outside_drawer", "bank_transfer", "other"]);
  });
  it("says which payments have no method recorded", () => {
    expect(methodLabel(null)).toBe("method not recorded");
    expect(methodLabel(undefined)).toBe("method not recorded");
    expect(methodLabel("legacy")).toBe("method not recorded");
    expect(methodLabel("bank_transfer")).toBe("Bank transfer");
    expect(methodLabel("cash_from_drawer")).toBe("Cash from the drawer");
  });
  it("needs a method, and a note of 5 or more characters for Other", () => {
    expect(methodProblem("", "x")).toMatch(/Choose how/);
    expect(methodProblem("legacy", "x")).toMatch(/Choose how/);
    expect(methodProblem("bank_transfer", "")).toBeNull();
    expect(methodProblem("cash_from_drawer", "")).toBeNull();
    expect(methodProblem("other", "abc")).toMatch(/at least 5/);
    expect(methodProblem("other", "    ab   ")).toMatch(/at least 5/);
    expect(methodProblem("other", "POS card")).toBeNull();
  });
  it("the screens read the method column", () => {
    expect(TXN_COLUMNS).toContain("payment_method");
  });
});
