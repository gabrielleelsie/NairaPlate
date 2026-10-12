import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "../routes/audit";

describe("audit screen labels", () => {
  it("has a readable label for the batch, channel payout, price decision and S4 events", () => {
    expect(AUDIT_ACTIONS["batch_reversed"]).toBe("Batch reversed");
    expect(AUDIT_ACTIONS["payout_reversed"]).toBe("Channel payout reversed");
    expect(AUDIT_ACTIONS["price_decision_reversed"]).toBe("Price decision reversed");
    expect(AUDIT_ACTIONS["batch_figures_recalculated"]).toBe(
      "Batch figures recalculated by the database",
    );
    expect(AUDIT_ACTIONS["wastage_cost_recalculated"]).toBe(
      "Wastage cost recalculated by the database",
    );
  });
  it("keeps the existing cash payout labels", () => {
    expect(AUDIT_ACTIONS["cash_payout_reversed"]).toBe("Cash payout reversed");
    expect(AUDIT_ACTIONS["cash_payout_recorded"]).toBe("Cash taken out of the drawer");
  });
});
