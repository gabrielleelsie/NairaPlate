import { describe, expect, it } from "vitest";
import { costBasisLabel, overallCostBasis, reasonLabel } from "./late-entry-cost";

describe("late-entry cost labels", () => {
  it("labels each stored basis", () => {
    expect(costBasisLabel("sale_time_exact")).toBe("Costed at sale time");
    expect(costBasisLabel("sale_time_backfilled")).toBe("Costed at sale time — reconstructed history");
    expect(costBasisLabel("estimated_current_price")).toBe("Estimated — today's prices");
    expect(costBasisLabel(null)).toBeNull();
  });
  it("one estimated line marks the whole sale as estimated", () => {
    expect(overallCostBasis(["sale_time_exact", "estimated_current_price"])).toBe("estimated_current_price");
    expect(overallCostBasis(["sale_time_exact", "sale_time_backfilled"])).toBe("sale_time_backfilled");
    expect(overallCostBasis([null])).toBeNull();
  });
  it("explains missing-price reasons in plain words", () => {
    expect(reasonLabel("no_price_before_sale_time")).toBe("no price recorded before the sale time");
  });
});
