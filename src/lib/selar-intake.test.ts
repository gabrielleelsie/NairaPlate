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
    expect(line).toContain("Format: json");
    expect(line).toContain("Fields: order_id.");
  });
  it("cuts a very long message", () => {
    const raw = "x".repeat(SELAR_LOG_MAX_CHARS + 500);
    const line = logLine(raw, { format: "unreadable", fields: null });
    expect(line).toContain("[cut]");
    expect(line.length).toBeLessThan(raw.length);
  });
});

import { cleanCode, extractPayment, fallbackRef, guessPlan, nairaToKobo } from "./selar-intake";

describe("nairaToKobo", () => {
  it("reads plain amounts in naira", () => {
    expect(nairaToKobo("NGN 4,991.00")).toBe(499100);
    expect(nairaToKobo("₦10,000")).toBe(1000000);
    expect(nairaToKobo("4991.5")).toBe(499150);
    expect(nairaToKobo("100")).toBe(10000);
  });
  it("refuses anything else", () => {
    for (const v of [null, "", "free", "USD 5.123", "1e5", "-100"]) expect(nairaToKobo(v)).toBeNull();
  });
});

describe("extractPayment", () => {
  it("finds fields under the likely names", () => {
    const p = extractPayment({
      "Order ID": "SEL-123", "Customer Name": "Ada Kitchen", "Customer Email": "ada@x.com",
      "Product Name": "NairaPlate Restaurant Monthly + Setup", "Amount Paid": "NGN 25,000.00", "Purchase Date": "2026-10-14",
      "Enter your NairaPlate business code": "ada-kitchen",
    });
    expect(p).toEqual({
      orderRef: "SEL-123", businessCode: "ada-kitchen", buyerName: "Ada Kitchen", buyerEmail: "ada@x.com",
      productName: "NairaPlate Restaurant Monthly + Setup", amountKobo: 2500000, currency: "NGN", paidAt: "2026-10-14",
    });
  });
  it("leaves missing fields empty instead of guessing", () => {
    const p = extractPayment({ foo: "bar" });
    expect(p).toEqual({ orderRef: null, businessCode: null, buyerName: null, buyerEmail: null, productName: null, amountKobo: null, currency: null, paidAt: null });
  });
  it("reads numbers as well as text", () => expect(extractPayment({ order_id: 5512, amount: 10000 }).amountKobo).toBe(1000000));
  it("reports a currency other than naira so it can be flagged", () => expect(extractPayment({ amount: "USD 10.00" }).currency).toBe("USD"));
});

describe("guessPlan", () => {
  it("reads the term and setup from the product name", () => {
    expect(guessPlan("NairaPlate Restaurant Monthly")).toEqual({ term: "monthly", setup: false });
    expect(guessPlan("NairaPlate Restaurant 3 Months + Setup")).toEqual({ term: "quarterly", setup: true });
    expect(guessPlan("NairaPlate Full Suite 12 Months")).toEqual({ term: "yearly", setup: false });
    expect(guessPlan("NairaPlate Buka Yearly + Setup")).toEqual({ term: "yearly", setup: true });
  });
  it("gives no term when the name does not say", () => {
    expect(guessPlan("NairaPlate Restaurant")).toEqual({ term: null, setup: false });
    expect(guessPlan(null)).toEqual({ term: null, setup: false });
  });
});

describe("fallbackRef and cleanCode", () => {
  it("gives the same fingerprint to the same message and a different one to another", async () => {
    expect(await fallbackRef("abc")).toBe(await fallbackRef("abc"));
    expect(await fallbackRef("abc")).not.toBe(await fallbackRef("abd"));
    expect(await fallbackRef("abc")).toMatch(/^raw:[0-9a-f]{24}$/);
  });
  it("tidies a business code", () => {
    expect(cleanCode("  Ada-Kitchen ")).toBe("ada-kitchen");
    expect(cleanCode("   ")).toBeNull();
    expect(cleanCode(null)).toBeNull();
  });
});
