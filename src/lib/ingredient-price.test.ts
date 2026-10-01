import { describe, expect, it } from "vitest";
import { gradeSeasonProblem, needsGradeAndSeason } from "./ingredient-price";

describe("needsGradeAndSeason", () => {
  it("asks for a priced new ingredient", () => expect(needsGradeAndSeason({ isNew: true, savedKobo: null, newKobo: 5000 })).toBe(true));
  it("does not ask for a new ingredient with no price yet", () => expect(needsGradeAndSeason({ isNew: true, savedKobo: null, newKobo: 0 })).toBe(false));
  it("asks when the price changes", () => expect(needsGradeAndSeason({ isNew: false, savedKobo: 5000, newKobo: 5500 })).toBe(true));
  it("does not ask when only the name or reorder level changes", () => expect(needsGradeAndSeason({ isNew: false, savedKobo: 5000, newKobo: 5000 })).toBe(false));
  it("asks when a zero-priced ingredient gets its first price", () => expect(needsGradeAndSeason({ isNew: false, savedKobo: 0, newKobo: 1200 })).toBe(true));
  it("does not ask when the price is cleared to zero", () => expect(needsGradeAndSeason({ isNew: false, savedKobo: 5000, newKobo: 0 })).toBe(false));
});

describe("gradeSeasonProblem", () => {
  it("needs a grade first", () => expect(gradeSeasonProblem("", "normal")).toMatch(/grade/i));
  it("then a season", () => expect(gradeSeasonProblem("A", "")).toMatch(/season/i));
  it("passes when both are chosen", () => expect(gradeSeasonProblem("B", "scarce")).toBeNull());
});
