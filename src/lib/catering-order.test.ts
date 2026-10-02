import { describe, expect, it } from "vitest";
import { draftProblem, orderTotals, statusActions, totalsText, type DraftLine } from "@/lib/catering-order";

const dish = (q: number, p = 300000): DraftLine => ({ key: "a", recipeId: "r1", name: "Jollof rice", quantity: q, unitPriceKobo: p, custom: false });
const custom = (q: number, p: number): DraftLine => ({ key: "b", recipeId: null, name: "Small chops", quantity: q, unitPriceKobo: p, custom: true });
const base = { role: "cashier", customer: "Mama Ada", date: "2026-10-10", time: "12:00", today: "2026-10-02", lines: [dish(2)], deliveryKobo: 0, discountKobo: 0, depositKobo: 0 };

describe("orderTotals", () => {
  it("adds lines and delivery, takes off the discount", () => {
    const t = orderTotals({ lines: [dish(2), custom(1, 150000)], deliveryKobo: 50000, discountKobo: 100000, depositKobo: 200000 });
    expect(t).toEqual({ subtotal: 750000, total: 700000, balance: 500000 });
  });
  it("rounds a part quantity to a whole kobo", () => {
    expect(orderTotals({ lines: [dish(0.5, 12345)], deliveryKobo: 0, discountKobo: 0, depositKobo: 0 }).subtotal).toBe(6173);
  });
});

describe("draftProblem", () => {
  it("accepts a normal order", () => expect(draftProblem(base)).toBeNull());
  it("needs a name, a date and a time", () => {
    expect(draftProblem({ ...base, customer: " " })).toMatch(/customer name/);
    expect(draftProblem({ ...base, time: "" })).toMatch(/date and time/);
  });
  it("refuses a past date but allows today", () => {
    expect(draftProblem({ ...base, date: "2026-10-01" })).toMatch(/already passed/);
    expect(draftProblem({ ...base, date: "2026-10-02" })).toBeNull();
  });
  it("needs items with a quantity", () => {
    expect(draftProblem({ ...base, lines: [] })).toMatch(/at least one/);
    expect(draftProblem({ ...base, lines: [dish(0)] })).toMatch(/quantity/);
  });
  it("keeps custom items and discounts for owners", () => {
    expect(draftProblem({ ...base, lines: [custom(1, 1000)] })).toMatch(/Only an owner/);
    expect(draftProblem({ ...base, discountKobo: 100 })).toMatch(/Only an owner/);
    expect(draftProblem({ ...base, role: "owner", lines: [custom(1, 1000)], discountKobo: 100 })).toBeNull();
  });
  it("checks discount, total and deposit", () => {
    expect(draftProblem({ ...base, role: "owner", discountKobo: 600001 })).toMatch(/discount/);
    expect(draftProblem({ ...base, role: "owner", lines: [custom(1, 0)] })).toMatch(/more than zero/);
    expect(draftProblem({ ...base, depositKobo: 600001 })).toMatch(/deposit/);
    expect(draftProblem({ ...base, depositKobo: 600000 })).toBeNull();
  });
});

describe("statusActions", () => {
  it("lets a cashier confirm and deliver but not cancel", () => {
    expect(statusActions("enquiry", "cashier").map((a) => a.to)).toEqual(["confirmed"]);
    expect(statusActions("confirmed", "cashier").map((a) => a.to)).toEqual(["delivered"]);
  });
  it("lets an owner cancel an open order", () => {
    expect(statusActions("confirmed", "owner").map((a) => a.to)).toEqual(["delivered", "cancelled"]);
    expect(statusActions("enquiry", "owner").map((a) => a.to)).toEqual(["confirmed", "cancelled"]);
  });
  it("gives nothing for delivered or cancelled", () => {
    expect(statusActions("delivered", "owner")).toEqual([]);
    expect(statusActions("cancelled", "owner")).toEqual([]);
  });
});

describe("totalsText", () => {
  it("reads the sums back", () => {
    const t = orderTotals({ lines: [dish(2)], deliveryKobo: 50000, discountKobo: 0, depositKobo: 100000 });
    expect(totalsText(t, 50000, 0, 100000)).toContain("still to pay");
  });
});
