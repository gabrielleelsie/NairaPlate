import { describe, expect, it } from "vitest";
import { basicAuth, hmacSha512Hex, kobo, parseMonnifyPayment, parseTransferAccount, referenceOf, verifyMonnifySignature } from "./payments";

const REF = "NP" + "AB".repeat(16);
const good = { eventType: "SUCCESSFUL_TRANSACTION", eventData: { transactionReference: "MNFY|1", paymentReference: REF, amountPaid: 1500.5, paymentStatus: "PAID" } };

describe("signature", () => {
  it("accepts the right signature and rejects every other", async () => {
    const body = JSON.stringify(good);
    const sig = await hmacSha512Hex("topsecret1", body);
    expect(await verifyMonnifySignature("topsecret1", body, sig)).toBe(true);
    expect(await verifyMonnifySignature("topsecret1", body, sig.toUpperCase())).toBe(true);
    expect(await verifyMonnifySignature("topsecret1", body + " ", sig)).toBe(false);
    expect(await verifyMonnifySignature("othersecret", body, sig)).toBe(false);
    expect(await verifyMonnifySignature("topsecret1", body, null)).toBe(false);
    expect(await verifyMonnifySignature("topsecret1", body, "")).toBe(false);
  });
  it("matches a known HMAC-SHA512 value", async () => {
    // RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?"
    expect(await hmacSha512Hex("Jefe", "what do ya want for nothing?")).toBe(
      "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737");
  });
});

describe("parseMonnifyPayment", () => {
  it("reads a paid transaction and converts naira to kobo", () => {
    expect(parseMonnifyPayment(good)).toEqual({ event_id: "MNFY|1", reference: REF, amount_kobo: 150050 });
  });
  it("ignores other events, unpaid and malformed messages", () => {
    expect(parseMonnifyPayment({ ...good, eventType: "SUCCESSFUL_DISBURSEMENT" })).toBeNull();
    expect(parseMonnifyPayment({ ...good, eventData: { ...good.eventData, paymentStatus: "PENDING" } })).toBeNull();
    expect(parseMonnifyPayment({ ...good, eventData: { ...good.eventData, amountPaid: 0 } })).toBeNull();
    expect(parseMonnifyPayment({ ...good, eventData: { ...good.eventData, paymentReference: "" } })).toBeNull();
    expect(parseMonnifyPayment(null)).toBeNull();
    expect(parseMonnifyPayment("x")).toBeNull();
  });
  it("accepts an amount sent as text", () => {
    expect(parseMonnifyPayment({ ...good, eventData: { ...good.eventData, amountPaid: "2000" } })?.amount_kobo).toBe(200000);
  });
});

describe("referenceOf", () => {
  it("only accepts our own reference shape", () => {
    expect(referenceOf(good)).toBe(REF);
    expect(referenceOf({ eventData: { paymentReference: "something-else" } })).toBeNull();
    expect(referenceOf(undefined)).toBeNull();
  });
});

describe("parseTransferAccount", () => {
  it("reads the account and works out when it expires", () => {
    const now = new Date("2026-10-01T10:00:00Z");
    const a = parseTransferAccount({ responseBody: { accountNumber: "1234567890", bankName: "Moniepoint", accountName: "NairaPlate / Shop", accountDurationSeconds: 600 } }, now);
    expect(a).toEqual({ account_number: "1234567890", bank_name: "Moniepoint", account_name: "NairaPlate / Shop", expires_at: "2026-10-01T10:10:00.000Z" });
  });
  it("returns null without a usable account number", () => {
    expect(parseTransferAccount({ responseBody: { accountNumber: "abc" } })).toBeNull();
    expect(parseTransferAccount({})).toBeNull();
    expect(parseTransferAccount(null)).toBeNull();
  });
});

describe("helpers", () => {
  it("kobo rounds safely", () => { expect(kobo(1500.5)).toBe(150050); expect(kobo(0.1 + 0.2)).toBe(30); });
  it("basic auth header", () => { expect(basicAuth("a", "b")).toBe("Basic YTpi"); });
});
