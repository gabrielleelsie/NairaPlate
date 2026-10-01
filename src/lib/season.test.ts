import { describe, expect, it } from "vitest";
import { extractSeason, isSeason, seasonHint, seasonLabel } from "./season";

describe("season helpers", () => {
  it("accepts only the three labels", () => {
    expect(isSeason("plenty")).toBe(true);
    expect(isSeason("Plenty")).toBe(false);
    expect(isSeason(null)).toBe(false);
    expect(seasonLabel("scarce")).toBe("Scarce");
    expect(seasonLabel(null)).toBe("No season");
  });
  it("pulls a spoken season out of the transcript", () => {
    expect(extractSeason("five derica garri grade b scarce four five hundred")).toEqual({ season: "scarce", rest: "five derica garri grade b four five hundred" });
    expect(extractSeason("tomato is plenty").season).toBe("plenty");
    expect(extractSeason("two bag of rice").season).toBeNull();
  });
  it("gives no hint with fewer than 6 past purchases", () => {
    expect(seasonHint(1000, [1000, 1000, 1000, 1000, 1000])).toBeNull();
  });
  it("hints from the median of past prices", () => {
    const past = [1000, 1000, 1100, 900, 1000, 1000]; // usual 1000
    expect(seasonHint(780, past)).toEqual({ season: "plenty", pctVsUsual: -22 });
    expect(seasonHint(1300, past)).toEqual({ season: "scarce", pctVsUsual: 30 });
    expect(seasonHint(1050, past)).toEqual({ season: "normal", pctVsUsual: 5 });
  });
  it("ignores bad numbers", () => {
    expect(seasonHint(0, [1, 1, 1, 1, 1, 1])).toBeNull();
    expect(seasonHint(100, [0, NaN, 1, 1, 1, 1])).toBeNull();
  });
});
