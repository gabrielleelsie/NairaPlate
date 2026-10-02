import { describe, expect, it } from "vitest";
import { amountProblem, balanceKobo, canReverse, canTakePayment, canWriteOff, debtStatus, describeEntries, normaliseDebts, reasonOk, totalOwed, type CreditEntry, type Debt } from "./credit";

const debt = (o: Partial<Debt> = {}): Debt => ({ id: "d1", customer_name: "Mr Bello", phone: null, amount_kobo: 150000, paid_kobo: 0, written_off_kobo: 0, settled: false, order_id: null, note: null, created_at: "2026-10-01T10:00:00Z", ...o });
const entry = (o: Partial<CreditEntry>): CreditEntry => ({ id: "e1", credit_id: "d1", kind: "payment", amount_kobo: 50000, method: "cash", reverses_id: null, reason: null, carried_over: false, recorded_by_name: "Cash", created_at: "2026-10-01T11:00:00Z", ...o });

describe("balance", () => {
  it("is amount minus paid minus written off", () => {
    expect(balanceKobo(debt({ paid_kobo: 50000, written_off_kobo: 20000 }))).toBe(80000);
  });
  it("is never below zero", () => expect(balanceKobo(debt({ paid_kobo: 200000 }))).toBe(0));
  it("totals only debts that are not settled", () => {
    const rows = [debt({ paid_kobo: 50000 }), debt({ id: "d2", amount_kobo: 250000, paid_kobo: 250000, settled: true }), debt({ id: "d3", amount_kobo: 90000 })];
    expect(totalOwed(rows)).toBe(100000 + 90000);
  });
  it("reads numbers from text columns", () => {
    const d = normaliseDebts([{ ...debt(), amount_kobo: "150000", paid_kobo: "50000", written_off_kobo: null }])[0]!;
    expect(d.amount_kobo).toBe(150000); expect(d.paid_kobo).toBe(50000); expect(d.written_off_kobo).toBe(0);
  });
});

describe("status", () => {
  it("owing, part paid, paid, written off", () => {
    expect(debtStatus(debt())).toBe("owing");
    expect(debtStatus(debt({ paid_kobo: 1 }))).toBe("part_paid");
    expect(debtStatus(debt({ written_off_kobo: 1 }))).toBe("part_paid");
    expect(debtStatus(debt({ paid_kobo: 150000, settled: true }))).toBe("paid");
    expect(debtStatus(debt({ written_off_kobo: 150000, settled: true }))).toBe("written_off");
    expect(debtStatus(debt({ paid_kobo: 100000, written_off_kobo: 50000, settled: true }))).toBe("paid");
  });
});

describe("entries", () => {
  it("marks a payment that a later reversal has undone", () => {
    const rows = [entry({}), entry({ id: "r1", kind: "reversal", amount_kobo: -50000, reverses_id: "e1", reason: "wrong customer", created_at: "2026-10-01T12:00:00Z" })];
    const v = describeEntries(rows);
    expect(v[0]!.reversed).toBe(true); expect(v[0]!.reversedByReason).toBe("wrong customer"); expect(v[1]!.reversed).toBe(false);
    expect(v.map((x) => x.label)).toEqual(["Payment", "Reversal"]);
  });
  it("uses the word Written off for write-offs", () => expect(describeEntries([entry({ kind: "write_off", method: null })])[0]!.label).toBe("Written off"));
  it("lists oldest first", () => {
    const v = describeEntries([entry({ id: "b", created_at: "2026-10-02T00:00:00Z" }), entry({ id: "a", created_at: "2026-10-01T00:00:00Z" })]);
    expect(v.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("who can do what", () => {
  const e = describeEntries([entry({})])[0]!;
  it("only owners reverse, and only once, never a reversal", () => {
    expect(canReverse(e, "owner")).toBe(true); expect(canReverse(e, "supa_admin")).toBe(true);
    expect(canReverse(e, "cashier")).toBe(false); expect(canReverse(e, "purchaser")).toBe(false);
    expect(canReverse({ ...e, reversed: true }, "owner")).toBe(false);
    expect(canReverse({ ...e, kind: "reversal" }, "owner")).toBe(false);
  });
  it("only owners write off, and only while owing", () => {
    expect(canWriteOff(debt(), "owner")).toBe(true);
    expect(canWriteOff(debt(), "cashier")).toBe(false);
    expect(canWriteOff(debt({ paid_kobo: 150000 }), "owner")).toBe(false);
  });
  it("cashiers and owners take payments while owing; cooks and purchasers cannot", () => {
    expect(canTakePayment(debt(), "cashier")).toBe(true); expect(canTakePayment(debt(), "owner")).toBe(true);
    expect(canTakePayment(debt(), "cook")).toBe(false); expect(canTakePayment(debt(), "purchaser")).toBe(false); expect(canTakePayment(debt(), null)).toBe(false);
    expect(canTakePayment(debt({ paid_kobo: 150000 }), "cashier")).toBe(false);
  });
});

describe("amount", () => {
  const d = debt({ paid_kobo: 50000 });
  it("accepts part and the whole balance", () => { expect(amountProblem(10000, d)).toBeNull(); expect(amountProblem(100000, d)).toBeNull(); });
  it("refuses zero, negatives, NaN and more than owed", () => {
    expect(amountProblem(0, d)).not.toBeNull(); expect(amountProblem(-5, d)).not.toBeNull(); expect(amountProblem(NaN, d)).not.toBeNull();
    expect(amountProblem(100001, d)).toBe("That is more than the customer owes.");
  });
  it("needs a reason of 5 or more characters", () => { expect(reasonOk("abcd")).toBe(false); expect(reasonOk("  abcd ")).toBe(false); expect(reasonOk("abcde")).toBe(true); });
});
