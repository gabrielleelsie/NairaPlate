import { describe, expect, it } from "vitest";
import {
  COST_TOLERANCE_KOBO,
  costDiffers,
  costToShow,
  differingCostNotice,
  savedKobo,
} from "./saved-figures";

const naira = (kobo: number) => `₦${(kobo / 100).toFixed(2)}`;

describe("savedKobo", () => {
  it("reads numbers and numeric strings, rounded to a whole kobo", () => {
    expect(savedKobo(120000)).toBe(120000);
    expect(savedKobo("120000")).toBe(120000);
    expect(savedKobo(80000.4)).toBe(80000);
  });
  it("returns null for anything that is not a number", () => {
    for (const v of [undefined, null, "", "  ", "abc", NaN, Infinity, {}, []])
      expect(savedKobo(v)).toBeNull();
  });
});

describe("costToShow", () => {
  it("shows the saved cost when the database gave one", () =>
    expect(costToShow(120000, 100000)).toBe(120000));
  it("falls back to the screen's own figure when there is no saved cost", () => {
    expect(costToShow(undefined, 100000)).toBe(100000);
    expect(costToShow(null, 100000)).toBe(100000);
    expect(costToShow("oops", 100000)).toBe(100000);
  });
});

describe("costDiffers", () => {
  it("uses a tolerance of 1 kobo, the same as the database", () => {
    expect(COST_TOLERANCE_KOBO).toBe(1);
    expect(costDiffers(120000, 120000)).toBe(false);
    expect(costDiffers(120001, 120000)).toBe(false);
    expect(costDiffers(119999, 120000)).toBe(false);
    expect(costDiffers(120002, 120000)).toBe(true);
    expect(costDiffers(0, 120000)).toBe(true);
  });
  it("is false when the database gave no saved cost", () =>
    expect(costDiffers(undefined, 120000)).toBe(false));
});

describe("differingCostNotice", () => {
  it("says what was saved and what the screen showed, and tells the person to refresh", () => {
    expect(differingCostNotice(130000, 120000, naira)).toBe(
      "The database used today's ingredient prices and saved ₦1300.00. Your screen showed ₦1200.00, so its prices may be out of date. Refresh the page.",
    );
  });
  it("is null when the figures agree within a kobo or the saved cost is missing", () => {
    expect(differingCostNotice(120001, 120000, naira)).toBeNull();
    expect(differingCostNotice(undefined, 120000, naira)).toBeNull();
  });
});
