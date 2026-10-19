import { describe, expect, it } from "vitest";
import { escapeLike, normalizeEmail } from "./selar-intake";

describe("normalizeEmail and escapeLike", () => {
  it("tidies a plain address and refuses anything else", () => {
    expect(normalizeEmail("  Ada@Kitchen.COM ")).toBe("ada@kitchen.com");
    for (const v of [null, "", "no-at-sign", "a b@c.com", "a@b"]) expect(normalizeEmail(v)).toBeNull();
  });
  it("escapes the wildcard characters so the match is exact", () => {
    expect(escapeLike("a_b%c@x.com")).toBe("a\\_b\\%c@x.com");
  });
});
