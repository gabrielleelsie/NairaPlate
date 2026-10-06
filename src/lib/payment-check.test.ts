import { describe, expect, it } from "vitest";
import { checkPaymentAmount, expectedPayment } from "./payment-check";
import { DEFAULT_SETTINGS } from "./platform-settings";

const prices = DEFAULT_SETTINGS.prices;

describe("expectedPayment", () => {
  it("is the price of the plan and period", () => {
    expect(expectedPayment(prices, "buka", "monthly", false)?.kobo).toBe(500_000);
    expect(expectedPayment(prices, "standard", "quarterly", false)?.kobo).toBe(2_700_000);
    expect(expectedPayment(prices, "advanced", "yearly", false)?.kobo).toBe(19_200_000);
  });
  it("adds the setup fee when the payment includes it", () => {
    expect(expectedPayment(prices, "standard", "monthly", true)?.kobo).toBe(1_000_000 + 1_500_000); // 10,000 + 15,000 = 25,000
    expect(expectedPayment(prices, "buka", "yearly", true)?.kobo).toBe(4_800_000 + 1_000_000); // 48,000 + 10,000 = 58,000
  });
  it("cannot be worked out without a profile or a price, so nothing is checked", () => {
    expect(expectedPayment(prices, null, "monthly", false)).toBeNull();
    expect(expectedPayment(null, "buka", "monthly", false)).toBeNull();
    const blank = { plans: { ...prices.plans, buka: { ...prices.plans.buka, monthly_kobo: null, setup_kobo: null } } };
    expect(expectedPayment(blank, "buka", "monthly", false)).toBeNull();
    expect(expectedPayment(blank, "buka", "quarterly", true)).toBeNull(); // setup asked for but not priced
  });
});

describe("checkPaymentAmount", () => {
  const exp = expectedPayment(prices, "standard", "monthly", false)!;
  it("passes the exact amount with no reason", () => {
    expect(checkPaymentAmount(1_000_000, exp, undefined)).toEqual({ ok: true, matches: true, reason: null });
  });
  it("refuses a different amount without a reason, and names the expected amount", () => {
    const r = checkPaymentAmount(900_000, exp, undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Restaurant monthly ₦10,000");
    expect(checkPaymentAmount(900_000, exp, "ok").ok).toBe(false); // too short
  });
  it("accepts a different amount with a reason", () => {
    expect(checkPaymentAmount(900_000, exp, "  Opening discount agreed on WhatsApp ")).toEqual({ ok: true, matches: false, reason: "Opening discount agreed on WhatsApp" });
  });
  it("checks nothing when there is no expected amount", () => {
    expect(checkPaymentAmount(123, null, undefined).ok).toBe(true);
  });
});
