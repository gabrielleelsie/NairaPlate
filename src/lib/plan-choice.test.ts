import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./platform-settings";
import { amountFor, needsNoTrialDate, noTrialEndsAt, planDifferences, planFromAmount, planText, waitingToPay } from "./plan-choice";

const prices = DEFAULT_SETTINGS.prices;

describe("amountFor", () => {
  it("reads the price list", () => {
    expect(amountFor(prices, "buka", "monthly")).toBe(500_000);
    expect(amountFor(prices, "standard", "quarterly")).toBe(2_700_000);
    expect(amountFor(prices, "advanced", "yearly")).toBe(19_200_000);
  });
  it("gives null when there is no price", () => {
    expect(amountFor(null, "buka", "monthly")).toBeNull();
    expect(amountFor({ plans: { ...prices.plans, buka: { ...prices.plans.buka, monthly_kobo: null } } }, "buka", "monthly")).toBeNull();
  });
});

describe("planFromAmount", () => {
  it("finds the plan type and term from every price on the list, with no two prices alike", () => {
    for (const mode of ["buka", "standard", "advanced"] as const)
      for (const term of ["monthly", "quarterly", "yearly"] as const)
        expect(planFromAmount(prices, amountFor(prices, mode, term))).toEqual({ mode, term });
  });
  it("gives null for an amount on no price, zero or missing", () => {
    for (const k of [123, 0, -5, null, undefined]) expect(planFromAmount(prices, k as number | null | undefined)).toBeNull();
  });
  it("gives null when two plans share a price, because it cannot tell", () => {
    const same = { plans: { ...prices.plans, standard: { ...prices.plans.standard, monthly_kobo: 500_000 } } };
    expect(planFromAmount(same, 500_000)).toBeNull();
  });
});

describe("planText and planDifferences", () => {
  it("names a plan", () => expect(planText({ mode: "standard", term: "yearly" })).toBe("Restaurant, 12 months"));
  it("is empty when everything agrees", () =>
    expect(planDifferences({ paid: { mode: "buka", term: "monthly" }, kitchenMode: "buka", chosen: { mode: "buka", term: "monthly" } })).toEqual([]));
  it("says when the kitchen is on another plan type", () =>
    expect(planDifferences({ paid: { mode: "standard", term: "monthly" }, kitchenMode: "buka", chosen: null })).toEqual(["Paid for Restaurant, monthly. This kitchen is on Buka."]));
  it("says when the owner chose something else", () =>
    expect(planDifferences({ paid: { mode: "buka", term: "yearly" }, kitchenMode: "buka", chosen: { mode: "buka", term: "monthly" } })).toEqual([
      "The owner chose Buka, monthly on the plan page, but paid for Buka, 12 months.",
    ]));
  it("says when the amount matches no plan", () =>
    expect(planDifferences({ paid: null, kitchenMode: "buka", chosen: null })).toEqual(["The amount paid matches no plan on the price list."]));
});

describe("no trial for a store that comes through the payment route", () => {
  it("gives an end date that has already passed", () => {
    const now = Date.parse("2026-10-19T10:00:00Z");
    expect(noTrialEndsAt(now)).toBe("2026-10-19T09:59:59.000Z");
    expect(Date.parse(noTrialEndsAt(now))).toBeLessThan(now);
  });
  const ok = { status: "pending", accessEndsAt: null as string | null };
  it("prepares a waiting store that still has an empty end date", () => expect(needsNoTrialDate(ok)).toBe(true));
  it("refuses everything else", () => {
    expect(needsNoTrialDate({ ...ok, status: "approved" })).toBe(false);
    expect(needsNoTrialDate({ ...ok, status: "suspended" })).toBe(false);
    expect(needsNoTrialDate({ ...ok, accessEndsAt: "2026-10-20T00:00:00Z" })).toBe(false);
  });
});

describe("waitingToPay", () => {
  const c = (business_id: string, created_at: string, plan_mode = "buka", plan_term = "monthly") => ({ business_id, plan_mode, plan_term, created_at });
  it("lists a store that chose a plan and never paid, newest first", () => {
    const out = waitingToPay([c("a", "2026-10-18T10:00:00Z"), c("b", "2026-10-19T09:00:00Z", "standard", "yearly")], new Map());
    expect(out.map((i) => i.business_id)).toEqual(["b", "a"]);
    expect(out[0]).toEqual({ business_id: "b", mode: "standard", term: "yearly", chosen_at: "2026-10-19T09:00:00Z" });
  });
  it("shows each store once, with its newest choice", () => {
    const out = waitingToPay([c("a", "2026-10-18T10:00:00Z", "buka"), c("a", "2026-10-19T10:00:00Z", "advanced", "quarterly")], new Map());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ mode: "advanced", term: "quarterly" });
  });
  it("drops a store once a payment was recorded after its choice", () => {
    expect(waitingToPay([c("a", "2026-10-18T10:00:00Z")], new Map([["a", "2026-10-18T12:00:00+00:00"]]))).toEqual([]);
  });
  it("keeps a store that chose again after its last payment (a renewal)", () => {
    expect(waitingToPay([c("a", "2026-10-19T10:00:00Z")], new Map([["a", "2026-09-19T12:00:00Z"]]))).toHaveLength(1);
  });
  it("ignores a choice it cannot read", () => {
    expect(waitingToPay([c("a", "2026-10-18T10:00:00Z", "gold", "monthly"), c("b", "2026-10-18T10:00:00Z", "buka", "weekly")], new Map())).toEqual([]);
  });
});
