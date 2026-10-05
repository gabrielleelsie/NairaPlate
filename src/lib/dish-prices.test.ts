import { describe, expect, it } from "vitest";
import { lagosLocalToIso, priceAt, priceStatus } from "./dish-prices";

const rows = [
  { id: "a", effective_from: "2026-10-01T00:00:00Z", effective_to: "2026-10-05T08:00:00Z" },
  { id: "b", effective_from: "2026-10-05T08:00:00Z", effective_to: "2026-10-09T00:00:00Z" },
  { id: "c", effective_from: "2026-10-09T00:00:00Z", effective_to: null },
];

describe("dish price history", () => {
  it("picks the price that applied at a moment", () => {
    expect(priceAt(rows, Date.parse("2026-10-03T00:00:00Z"))?.id).toBe("a");
    expect(priceAt(rows, Date.parse("2026-10-05T08:00:00Z"))?.id).toBe("b");
    expect(priceAt(rows, Date.parse("2026-09-01T00:00:00Z"))).toBeNull();
  });
  it("labels scheduled, current and ended", () => {
    const now = Date.parse("2026-10-06T00:00:00Z");
    expect(rows.map((r) => priceStatus(r, now))).toEqual(["ended", "current", "scheduled"]);
  });
  it("reads Lagos time as UTC+1", () => {
    expect(lagosLocalToIso("2026-10-05T09:00")).toBe("2026-10-05T08:00:00.000Z");
    expect(lagosLocalToIso("bad")).toBeNull();
  });
});
