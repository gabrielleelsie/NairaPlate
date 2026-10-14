import { describe, expect, it } from "vitest";
import { SELAR_LOG_MAX_CHARS, logLine, parseMessage, secretFromSetting, tokenMatches } from "./selar-intake";

const SECRET = "a".repeat(24);

describe("secretFromSetting", () => {
  it("accepts a long enough secret", () => expect(secretFromSetting({ secret: SECRET })).toBe(SECRET));
  it("refuses missing, short or non-text secrets", () => {
    for (const v of [null, undefined, {}, { secret: "short" }, { secret: 12345678901234567890123456 }, "x"])
      expect(secretFromSetting(v)).toBeNull();
  });
});

describe("tokenMatches", () => {
  it("matches only the exact secret", () => {
    expect(tokenMatches(SECRET, SECRET)).toBe(true);
    expect(tokenMatches(SECRET + "b", SECRET)).toBe(false);
    expect(tokenMatches("b".repeat(24), SECRET)).toBe(false);
  });
  it("refuses when either side is missing", () => {
    expect(tokenMatches(null, SECRET)).toBe(false);
    expect(tokenMatches(undefined, SECRET)).toBe(false);
    expect(tokenMatches("", SECRET)).toBe(false);
    expect(tokenMatches(SECRET, null)).toBe(false);
  });
});

describe("parseMessage", () => {
  it("reads JSON", () => {
    const p = parseMessage('{"order_id":"SEL-1","amount":4991}', "application/json");
    expect(p).toEqual({ format: "json", fields: { order_id: "SEL-1", amount: 4991 } });
  });
  it("reads JSON even when the content type is wrong", () =>
    expect(parseMessage('{"a":1}', "text/plain").format).toBe("json"));
  it("reads a form body", () => {
    const p = parseMessage("order_id=SEL-1&email=a%40b.com", "application/x-www-form-urlencoded");
    expect(p).toEqual({ format: "form", fields: { order_id: "SEL-1", email: "a@b.com" } });
  });
  it("treats broken JSON, arrays and plain text as unreadable", () => {
    expect(parseMessage("{oops", "application/json").format).toBe("unreadable");
    expect(parseMessage("[1,2]", "application/json").format).toBe("unreadable");
    expect(parseMessage("hello there", "text/plain").format).toBe("unreadable");
    expect(parseMessage("", null).format).toBe("unreadable");
  });
});

describe("logLine", () => {
  it("says nothing was recorded and lists the field names", () => {
    const line = logLine('{"order_id":"SEL-1"}', { format: "json", fields: { order_id: "SEL-1" } });
    expect(line).toContain("nothing was recorded or activated");
    expect(line).toContain("Fields: order_id.");
  });
  it("cuts a very long message", () => {
    const raw = "x".repeat(SELAR_LOG_MAX_CHARS + 500);
    const line = logLine(raw, { format: "unreadable", fields: null });
    expect(line).toContain("[cut]");
    expect(line.length).toBeLessThan(raw.length);
  });
});
