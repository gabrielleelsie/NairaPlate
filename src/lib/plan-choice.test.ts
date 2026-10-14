import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./platform-settings";
import { amountFor, canSkipTrial, planDifferences, planFromAmount, planText } from "./plan-choice";

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

describe("canSkipTrial", () => {
  const ok = { status: "approved", plan: "trial", paymentCount: 0, hasWaitingSelarPayment: true };
  it("allows a newly approved store that paid first", () => expect(canSkipTrial(ok)).toBe(true));
  it("refuses every other case", () => {
    expect(canSkipTrial({ ...ok, status: "pending" })).toBe(false);
    expect(canSkipTrial({ ...ok, status: "suspended" })).toBe(false);
    expect(canSkipTrial({ ...ok, plan: "monthly" })).toBe(false);
    expect(canSkipTrial({ ...ok, plan: null })).toBe(false);
    expect(canSkipTrial({ ...ok, paymentCount: 1 })).toBe(false);
    expect(canSkipTrial({ ...ok, hasWaitingSelarPayment: false })).toBe(false);
  });
});
