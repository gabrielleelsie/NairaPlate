import { describe, expect, it } from "vitest";
import { extractGrade, gradeLabel, isGrade } from "./grade";

describe("grade helpers", () => {
  it("accepts only A, B, C", () => {
    expect(isGrade("A")).toBe(true);
    expect(isGrade("D")).toBe(false);
    expect(isGrade(null)).toBe(false);
    expect(isGrade("a")).toBe(false);
  });
  it("pulls a spoken grade out of the transcript", () => {
    expect(extractGrade("five derica garri grade b four five hundred")).toEqual({ grade: "B", rest: "five derica garri four five hundred" });
    expect(extractGrade("tomato grade A two bag")).toEqual({ grade: "A", rest: "tomato two bag" });
  });
  it("leaves text alone when no grade is spoken", () => {
    expect(extractGrade("a bag of rice")).toEqual({ grade: null, rest: "a bag of rice" });
  });
  it("labels", () => {
    expect(gradeLabel("B")).toBe("Grade B");
    expect(gradeLabel(null)).toBe("No grade");
  });
});
