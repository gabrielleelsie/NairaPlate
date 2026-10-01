import { describe, expect, it } from "vitest";
import { TRIAL_LIMITS, isTrialPlan, trialLimitMessage, trialUsage } from "./trial-limits";

describe("trial limits", () => {
  it("uses the agreed numbers", () => {
    expect(TRIAL_LIMITS).toEqual({ recipes: 2, ingredientsPerRecipe: 12, ingredientsTotal: 20 });
  });
  it("only a trial plan is limited", () => {
    expect(isTrialPlan("trial")).toBe(true);
    for (const p of ["monthly", "quarterly", "yearly", null, undefined, ""]) expect(isTrialPlan(p)).toBe(false);
  });
  it("passes the database's trial message through and ignores other errors", () => {
    const m = "Free trial limit: a trial includes up to 2 recipes. Choose a plan to add more.";
    expect(trialLimitMessage(m)).toBe(m);
    expect(trialLimitMessage("new row violates row-level security policy")).toBeNull();
    expect(trialLimitMessage(null)).toBeNull();
  });
  it("never shows more used than the limit", () => {
    expect(trialUsage(1, 2, "recipes")).toBe("1 of 2 recipes used");
    expect(trialUsage(4, 2, "recipes")).toBe("2 of 2 recipes used");
  });
});
