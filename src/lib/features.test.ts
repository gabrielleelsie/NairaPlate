import { describe, expect, it } from "vitest";
import { MODE_DEFAULTS, hasFeature } from "./features";

describe("what each kitchen type has", () => {
  it("gives Buka the three tools the flyer promises", () => {
    for (const f of ["wastage", "stock_take", "audit_log"] as const) expect(hasFeature("buka", f)).toBe(true);
  });
  it("keeps the other extras out of Buka", () => {
    for (const f of ["customer_credit", "receipt_capture", "cost_check", "cashflow", "margin_diagnostic", "accountant_exports", "channel_payouts", "pricing_review", "catering"] as const)
      expect(hasFeature("buka", f)).toBe(false);
  });
  it("leaves Restaurant and Full Suite as they were", () => {
    expect(MODE_DEFAULTS.standard.channel_payouts).toBe(false);
    expect(MODE_DEFAULTS.standard.audit_log && MODE_DEFAULTS.standard.stock_take && MODE_DEFAULTS.standard.wastage).toBe(true);
    expect(MODE_DEFAULTS.advanced.channel_payouts).toBe(true);
    expect(MODE_DEFAULTS.advanced.catering).toBe(false);
  });
  it("lets an admin switch an extra on or off for one kitchen", () => {
    expect(hasFeature("buka", "customer_credit", { customer_credit: true })).toBe(true);
    expect(hasFeature("buka", "wastage", { wastage: false })).toBe(false);
  });
});
