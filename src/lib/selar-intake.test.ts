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

import { authorizeSelar, escapeLike, extractPayment, fallbackRef, findSignatureHeader, isSetupProduct, nairaToKobo, normalizeEmail, signatureMatches, signingKeyFromSetting } from "./selar-intake";

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
    });
    expect(p).toEqual({
      orderRef: "SEL-123", buyerName: "Ada Kitchen", buyerEmail: "ada@x.com",
      productName: "NairaPlate Restaurant Monthly + Setup", amountKobo: 2500000, currency: "NGN", paidAt: "2026-10-14",
    });
  });
  it("leaves missing fields empty instead of guessing", () => {
    const p = extractPayment({ foo: "bar" });
    expect(p).toEqual({ orderRef: null, buyerName: null, buyerEmail: null, productName: null, amountKobo: null, currency: null, paidAt: null });
  });
  it("reads numbers as well as text", () => expect(extractPayment({ order_id: 5512, amount: 10000 }).amountKobo).toBe(1000000));
  it("reports a currency other than naira so it can be flagged", () => expect(extractPayment({ amount: "USD 10.00" }).currency).toBe("USD"));
});

describe("isSetupProduct", () => {
  it("is true for the setup service and false for the subscription", () => {
    expect(isSetupProduct("NairaPlate Setup")).toBe(true);
    expect(isSetupProduct("nairaplate SETUP fee")).toBe(true);
    expect(isSetupProduct("NairaPlate Restaurant")).toBe(false);
    expect(isSetupProduct(null)).toBe(false);
  });
});

describe("normalizeEmail and escapeLike", () => {
  it("tidies a plain address and refuses anything else", () => {
    expect(normalizeEmail("  Ada@Kitchen.COM ")).toBe("ada@kitchen.com");
    for (const v of [null, "", "no-at-sign", "a b@c.com", "a@b"]) expect(normalizeEmail(v)).toBeNull();
  });
  it("escapes the wildcard characters so the match is exact", () => {
    expect(escapeLike("a_b%c@x.com")).toBe("a\\_b\\%c@x.com");
  });
});

describe("fallbackRef", () => {
  it("gives the same fingerprint to the same message and a different one to another", async () => {
    expect(await fallbackRef("abc")).toBe(await fallbackRef("abc"));
    expect(await fallbackRef("abc")).not.toBe(await fallbackRef("abd"));
    expect(await fallbackRef("abc")).toMatch(/^raw:[0-9a-f]{24}$/);
  });
});

// ---------- who is allowed to send ----------
const KEY = "selar-signing-key-1234";
const BODY = '{"order_id":"SEL-1","amount":"NGN 5,000.00"}';
async function sign(body: string, key: string, as: "hex" | "base64" | "base64url" = "hex") {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
  if (as === "hex") return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = btoa(String.fromCharCode(...mac));
  return as === "base64" ? b64 : b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("signatureMatches", () => {
  it("accepts the right signature as hex, upper-case hex, base64, base64url, or with a sha256= prefix", async () => {
    const hex = await sign(BODY, KEY);
    for (const v of [hex, hex.toUpperCase(), `sha256=${hex}`, await sign(BODY, KEY, "base64"), await sign(BODY, KEY, "base64url")])
      expect(await signatureMatches(BODY, v, KEY)).toBe(true);
  });
  it("refuses a signature made with another key, over another body, or that is unreadable", async () => {
    expect(await signatureMatches(BODY, await sign(BODY, "another-key-entirely"), KEY)).toBe(false);
    expect(await signatureMatches(BODY + " ", await sign(BODY, KEY), KEY)).toBe(false);
    for (const v of ["", "garbage", "sha256=", "abc123", null, undefined]) expect(await signatureMatches(BODY, v as string | null, KEY)).toBe(false);
  });
  it("refuses when there is no key", async () => expect(await signatureMatches(BODY, await sign(BODY, KEY), null)).toBe(false));
});

describe("findSignatureHeader and signingKeyFromSetting", () => {
  it("finds the first usual signature header", () => {
    const h: Record<string, string> = { "x-signature": " abc " };
    expect(findSignatureHeader((n) => h[n] ?? null)).toBe("abc");
    expect(findSignatureHeader(() => null)).toBeNull();
  });
  it("accepts a saved key of 8 or more characters only", () => {
    expect(signingKeyFromSetting({ signing_key: KEY })).toBe(KEY);
    for (const v of [null, {}, { signing_key: "short" }, { signing_key: 12345678 }]) expect(signingKeyFromSetting(v)).toBeNull();
  });
});

describe("authorizeSelar (unauthorized requests are refused)", () => {
  const setting = { secret: "s".repeat(30), signing_key: KEY };
  it("accepts a valid signature", async () =>
    expect(await authorizeSelar({ rawBody: BODY, signatureHeader: await sign(BODY, KEY), urlToken: null, setting })).toEqual({ ok: true, via: "signature" }));
  it("accepts the right secret on the address", async () =>
    expect(await authorizeSelar({ rawBody: BODY, signatureHeader: null, urlToken: "s".repeat(30), setting })).toEqual({ ok: true, via: "token" }));
  it("refuses a request with neither", async () =>
    expect(await authorizeSelar({ rawBody: BODY, signatureHeader: null, urlToken: null, setting })).toEqual({ ok: false }));
  it("refuses a wrong secret and a wrong signature together", async () =>
    expect(await authorizeSelar({ rawBody: BODY, signatureHeader: await sign(BODY, "wrong-key-wrong-key"), urlToken: "x".repeat(30), setting })).toEqual({ ok: false }));
  it("refuses a valid signature over a different body (a tampered message)", async () =>
    expect(await authorizeSelar({ rawBody: BODY + "x", signatureHeader: await sign(BODY, KEY), urlToken: null, setting })).toEqual({ ok: false }));
  it("refuses everything when nothing is set up", async () => {
    expect(await authorizeSelar({ rawBody: BODY, signatureHeader: await sign(BODY, KEY), urlToken: "x".repeat(30), setting: null })).toEqual({ ok: false });
    expect(await authorizeSelar({ rawBody: BODY, signatureHeader: await sign(BODY, KEY), urlToken: "short", setting: { secret: "short" } })).toEqual({ ok: false });
  });
});
