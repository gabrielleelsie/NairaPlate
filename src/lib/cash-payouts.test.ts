import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYOUT_LIMIT_KOBO, STATUS_LABEL, canReversePayout, cashierDirectTotalKobo, categoryLabel, classifyPayout, friendlyPayoutError, netPayoutsKobo, noteOk, reverseTargetId,
  payoutViews, pendingRequests, remainingAllowanceKobo, type PayoutRow,
} from "./cash-payouts";

let n = 0;
const row = (o: Partial<PayoutRow>): PayoutRow => ({
  id: `r${++n}`, drawer_id: "d1", kind: "payout", amount_kobo: 400000, category: "market_run", note: "tomatoes and pepper", reverses_id: null, approves_id: null,
  purchase_id: null, supplier_txn_id: null, recorded_by: "u1", recorded_by_role: "cashier", recorded_by_name: "Cash", created_at: "2026-10-03T10:00:00Z", ...o,
});

describe("the limit", () => {
  it("defaults to ₦10,000", () => expect(DEFAULT_PAYOUT_LIMIT_KOBO).toBe(1_000_000));
  it("lets a cashier take cash out while the shift total stays within the limit", () => {
    expect(classifyPayout({ role: "cashier", limitKobo: 1_000_000, directTotalKobo: 0, amountKobo: 1_000_000 })).toBe("direct");
    expect(classifyPayout({ role: "cashier", limitKobo: 1_000_000, directTotalKobo: 800_000, amountKobo: 200_000 })).toBe("direct");
  });
  it("turns the payout that would pass the limit into a request, so splitting does not help", () => {
    expect(classifyPayout({ role: "cashier", limitKobo: 1_000_000, directTotalKobo: 800_000, amountKobo: 200_001 })).toBe("request");
    expect(classifyPayout({ role: "cashier", limitKobo: 1_000_000, directTotalKobo: 0, amountKobo: 1_000_001 })).toBe("request");
    // three ₦4,000 payouts against a ₦10,000 limit: the third is a request
    const three = [400_000, 400_000, 400_000].map((a, i) => classifyPayout({ role: "cashier", limitKobo: 1_000_000, directTotalKobo: i * 400_000, amountKobo: a }));
    expect(three).toEqual(["direct", "direct", "request"]);
  });
  it("lets an owner take out any amount directly", () => {
    expect(classifyPayout({ role: "owner", limitKobo: 1_000_000, directTotalKobo: 5_000_000, amountKobo: 9_000_000 })).toBe("direct");
    expect(classifyPayout({ role: "supa_admin", limitKobo: 0, directTotalKobo: 0, amountKobo: 1 })).toBe("direct");
  });
  it("refuses other roles and amounts that are not above zero", () => {
    for (const r of ["cook", "purchaser", null, undefined]) expect(classifyPayout({ role: r, limitKobo: 1_000_000, directTotalKobo: 0, amountKobo: 100 })).toBe("invalid");
    expect(classifyPayout({ role: "cashier", limitKobo: 1_000_000, directTotalKobo: 0, amountKobo: 0 })).toBe("invalid");
  });
  it("says what is left to take out", () => {
    expect(remainingAllowanceKobo(1_000_000, 400_000)).toBe(600_000);
    expect(remainingAllowanceKobo(1_000_000, 1_200_000)).toBe(0);
  });
});

describe("what counts as cash out", () => {
  const p1 = row({ id: "p1", amount_kobo: 300000 });
  const p2 = row({ id: "p2", amount_kobo: 200000 });
  const rev = row({ id: "x1", kind: "reversal", amount_kobo: -200000, reverses_id: "p2", recorded_by_role: "owner" });
  const req = row({ id: "q1", kind: "request", amount_kobo: 900000 });
  it("is payouts minus reversals", () => expect(netPayoutsKobo([p1, p2, rev])).toBe(300000));
  it("ignores requests and declines", () => {
    const dec = row({ kind: "decline", amount_kobo: 900000, reverses_id: "q1", recorded_by_role: "owner" });
    expect(netPayoutsKobo([p1, req, dec])).toBe(300000);
  });
  it("counts an approved request once, as the payout row that approved it", () => {
    const ap = row({ id: "a1", kind: "payout", amount_kobo: 900000, approves_id: "q1", recorded_by_role: "owner" });
    expect(netPayoutsKobo([p1, req, ap])).toBe(1_200_000);
  });
  it("counts only direct cashier payouts toward the cashier's limit, and not reversed ones", () => {
    const ap = row({ kind: "payout", amount_kobo: 900000, approves_id: "q1", recorded_by_role: "owner" });
    const own = row({ kind: "payout", amount_kobo: 700000, recorded_by_role: "owner" });
    const fromPurchase = row({ kind: "payout", amount_kobo: 500000, category: "purchase", recorded_by_role: "purchaser", purchase_id: "pu1" });
    expect(cashierDirectTotalKobo([p1, p2, rev, ap, own, fromPurchase])).toBe(300000);
  });
});

describe("requests", () => {
  const req = row({ id: "q1", kind: "request", amount_kobo: 900000 });
  it("are pending until an approval or a decline points at them", () => {
    expect(pendingRequests([req]).map((r) => r.id)).toEqual(["q1"]);
    expect(pendingRequests([req, row({ kind: "payout", approves_id: "q1", amount_kobo: 900000, recorded_by_role: "owner" })])).toEqual([]);
    expect(pendingRequests([req, row({ kind: "decline", reverses_id: "q1", amount_kobo: 900000, recorded_by_role: "owner" })])).toEqual([]);
  });
});

describe("how entries are listed", () => {
  const p1 = row({ id: "p1" });
  const rev = row({ id: "x1", kind: "reversal", amount_kobo: -400000, reverses_id: "p1", note: "entered twice", recorded_by_role: "owner", recorded_by_name: "Boss" });
  const req = row({ id: "q1", kind: "request", amount_kobo: 900000, recorded_by_name: "Cash" });
  const dec = row({ id: "d9", kind: "decline", amount_kobo: 900000, reverses_id: "q1", note: "too much for gas", recorded_by_role: "owner", recorded_by_name: "Boss" });
  const req2 = row({ id: "q2", kind: "request", amount_kobo: 800000 });
  const ap = row({ id: "a1", kind: "payout", amount_kobo: 800000, approves_id: "q2", recorded_by_role: "owner", recorded_by_name: "Boss" });
  const views = payoutViews([p1, rev, req, dec, req2, ap, row({ id: "p3" })]);
  it("hides the settling rows and shows each entry with what happened", () => {
    expect(views.map((v) => `${v.id}:${v.status}`)).toEqual(["p1:reversed", "q1:declined", "q2:approved", "p3:recorded"]);
  });
  it("says who decided and why", () => {
    const v1 = views.find((v) => v.id === "p1")!, vq1 = views.find((v) => v.id === "q1")!;
    expect(v1.settledBy).toBe("Boss"); expect(v1.settledNote).toBe("entered twice");
    expect(vq1.settledNote).toBe("too much for gas");
  });
  it("offers Reverse only on a recorded payout, to owners", () => {
    expect(canReversePayout("owner", views.find((v) => v.id === "p3")!)).toBe(true);
    expect(canReversePayout("owner", views.find((v) => v.id === "p1")!)).toBe(false);
    expect(canReversePayout("cashier", views.find((v) => v.id === "p3")!)).toBe(false);
    expect(canReversePayout("owner", views.find((v) => v.id === "q1")!)).toBe(false);
  });
});

describe("reversing an approved request (G5)", () => {
  const q = row({ id: "q5", kind: "request", amount_kobo: 900000, recorded_by_role: "cashier", recorded_by_name: "Cash" });
  const ap = row({ id: "a5", kind: "payout", amount_kobo: 900000, approves_id: "q5", recorded_by_role: "owner", recorded_by_name: "Boss" });
  const rev = row({ id: "r5", kind: "reversal", amount_kobo: -900000, reverses_id: "a5", note: "approved by mistake", recorded_by_role: "owner", recorded_by_name: "Boss" });
  const before = payoutViews([q, ap]), after = payoutViews([q, ap, rev]);
  const viewOf = (views: ReturnType<typeof payoutViews>, id: string) => views.find((v) => v.id === id)!;

  it("lists an approved request once, with the approved entry behind it", () => {
    expect(before.map((v) => `${v.id}:${v.status}`)).toEqual(["q5:approved"]);
    expect(viewOf(before, "q5").settleId).toBe("a5");
  });
  it("lets an owner or supa admin reverse it, and nobody else", () => {
    expect(canReversePayout("owner", viewOf(before, "q5"))).toBe(true);
    expect(canReversePayout("supa_admin", viewOf(before, "q5"))).toBe(true);
    for (const r of ["cashier", "cook", "purchaser", null, undefined]) expect(canReversePayout(r, viewOf(before, "q5"))).toBe(false);
  });
  it("reverses the approved entry behind the request, not the request itself", () => {
    expect(reverseTargetId(viewOf(before, "q5"))).toBe("a5");
    expect(reverseTargetId(viewOf(payoutViews([row({ id: "p9" })]), "p9"))).toBe("p9");
  });
  it("reads Approved, then reversed afterwards, with who reversed it and why", () => {
    const v = viewOf(after, "q5");
    expect(after.map((x) => `${x.id}:${x.status}`)).toEqual(["q5:approved_reversed"]);
    expect(STATUS_LABEL[v.status]).toBe("Approved, then reversed");
    expect(v.settledBy).toBe("Boss");
    expect(v.settledNote).toBe("approved by mistake");
  });
  it("cannot be reversed twice", () => expect(canReversePayout("owner", viewOf(after, "q5"))).toBe(false));
  it("puts the cash back: the shift's net cash out returns to what it was before the approval", () => {
    expect(netPayoutsKobo([q, ap])).toBe(900000);
    expect(netPayoutsKobo([q, ap, rev])).toBe(0);
    expect(netPayoutsKobo([q, ap, rev])).toBe(netPayoutsKobo([q]));
  });
  it("leaves the cashier's allowance as it was: approved payouts never counted toward it", () => {
    expect(cashierDirectTotalKobo([q, ap])).toBe(0);
    expect(cashierDirectTotalKobo([q, ap, rev])).toBe(0);
  });
  it("does not offer Reverse on a waiting request, a declined request or a payout already reversed", () => {
    const waiting = viewOf(payoutViews([row({ id: "w1", kind: "request", amount_kobo: 900000 })]), "w1");
    const declined = viewOf(payoutViews([row({ id: "w2", kind: "request", amount_kobo: 900000 }), row({ id: "d2", kind: "decline", reverses_id: "w2", amount_kobo: 900000, recorded_by_role: "owner" })]), "w2");
    const reversed = viewOf(payoutViews([row({ id: "p8" }), row({ id: "x8", kind: "reversal", amount_kobo: -400000, reverses_id: "p8", recorded_by_role: "owner" })]), "p8");
    expect(canReversePayout("owner", waiting)).toBe(false);
    expect(canReversePayout("owner", declined)).toBe(false);
    expect(canReversePayout("owner", reversed)).toBe(false);
  });
  it("a request that was approved and reversed does not count as pending", () => expect(pendingRequests([q, ap, rev])).toEqual([]));
});

describe("words", () => {
  it("needs a note of 5 or more characters", () => { expect(noteOk("gas")).toBe(false); expect(noteOk("  gas   ")).toBe(false); expect(noteOk("gas for the stove")).toBe(true); });
  it("labels categories", () => { expect(categoryLabel("gas_fuel")).toBe("Gas or fuel"); expect(categoryLabel("supplier_payment")).toBe("Supplier payment"); expect(categoryLabel(null)).toBe(""); });
  it("turns database messages into plain sentences", () => {
    expect(friendlyPayoutError("A cash payout is waiting for the owner. Approve or decline it before closing the shift.")).toContain("waiting for the owner");
    expect(friendlyPayoutError("There is no open shift.")).toBe("There is no open shift. Open a shift first.");
    expect(friendlyPayoutError("other")).toBe("other");
  });
});
