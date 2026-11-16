import { describe, expect, it } from "vitest";
import { readMenuCache } from "./offline-menu";

const good = { businessId: "mama-put", savedAtUtc: "2026-11-16T08:00:00Z", recipes: [{ id: "r1", name: "Jollof rice", selling_price_kobo: 150000 }] };

describe("readMenuCache", () => {
  it("returns a well formed menu for the same business", () => expect(readMenuCache(good, "mama-put")).toEqual(good));
  it("reads a price saved as text", () =>
    expect(readMenuCache({ ...good, recipes: [{ id: "r1", name: "Jollof", selling_price_kobo: "150000" }] }, "mama-put")?.recipes[0]?.selling_price_kobo).toBe(150000));
  it("ignores another business's menu", () => expect(readMenuCache(good, "other-kitchen")).toBeNull());
  it("ignores anything malformed", () => {
    for (const bad of [null, undefined, "x", 5, {}, { ...good, savedAtUtc: "not a date" }, { ...good, recipes: "none" },
      { ...good, recipes: [{ id: 1, name: "x", selling_price_kobo: 1 }] }, { ...good, recipes: [{ id: "a", name: "x", selling_price_kobo: -5 }] },
      { ...good, recipes: [{ id: "a", name: "x", selling_price_kobo: "abc" }] }])
      expect(readMenuCache(bad, "mama-put")).toBeNull();
  });
  it("accepts an empty menu", () => expect(readMenuCache({ ...good, recipes: [] }, "mama-put")?.recipes).toEqual([]));
});
