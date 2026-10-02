import { describe, expect, it } from "vitest";
import { historyIds, saveErrorText, unitLocked, UNIT_LOCK_MESSAGE } from "./ingredient-guard";

describe("unitLocked", () => {
  const ids = new Set(["a", "b"]);
  it("locks an ingredient that has history", () => expect(unitLocked("a", ids)).toBe(true));
  it("leaves a new or unknown ingredient unlocked", () => {
    expect(unitLocked("c", ids)).toBe(false); expect(unitLocked(null, ids)).toBe(false); expect(unitLocked(undefined, ids)).toBe(false);
  });
});

describe("historyIds", () => {
  it("turns the database answer into a set", () => expect([...historyIds(["a", "b", "a"])].sort()).toEqual(["a", "b"]));
  it("copes with nothing or a bad answer", () => { expect(historyIds(null).size).toBe(0); expect(historyIds({}).size).toBe(0); });
});

describe("saveErrorText", () => {
  it("shows the database sentence for the unit and stock rules", () => {
    expect(saveErrorText(UNIT_LOCK_MESSAGE, "x")).toBe(UNIT_LOCK_MESSAGE);
    expect(saveErrorText("Stock and prices can only be changed by logging a purchase, a stock take, wastage or a price change.", "x")).toMatch(/only be changed/);
  });
  it("uses the fallback for anything else", () => { expect(saveErrorText("permission denied", "Could not save ingredient.")).toBe("Could not save ingredient."); expect(saveErrorText(null, "f")).toBe("f"); });
});
