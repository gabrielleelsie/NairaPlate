import { describe, expect, it } from "vitest";
import { lostTransferKobo, receivedKobo, receivedShare, TRANSFER_LOST } from "./order-revenue";

const lost = { status: TRANSFER_LOST, total_kobo: 100000, cash_amount_kobo: 40000, transfer_amount_kobo: 60000 };
describe("order revenue", () => {
  it("counts only the cash kept on a transfer-lost order", () => {
    expect(lostTransferKobo(lost)).toBe(60000);
    expect(receivedKobo(lost)).toBe(40000);
    expect(receivedShare(lost)).toBeCloseTo(0.4);
  });
  it("works from text numbers and from cash alone", () => {
    expect(receivedKobo({ status: TRANSFER_LOST, total_kobo: "100000", cash_amount_kobo: "40000", transfer_amount_kobo: "60000" })).toBe(40000);
    expect(receivedKobo({ status: TRANSFER_LOST, total_kobo: 100000, cash_amount_kobo: 40000 })).toBe(40000);
  });
  it("leaves every other order at its total", () => {
    for (const status of ["paid", "partially_refunded", "refunded", "cancelled", "awaiting_payment"]) {
      expect(receivedKobo({ status, total_kobo: 100000, cash_amount_kobo: 40000, transfer_amount_kobo: 60000 })).toBe(100000);
      expect(lostTransferKobo({ status, total_kobo: 100000, transfer_amount_kobo: 60000 })).toBe(0);
      expect(receivedShare({ status, total_kobo: 100000 })).toBe(1);
    }
  });
  it("does not guess when a transfer-lost order's amounts are missing", () => {
    expect(receivedKobo({ status: TRANSFER_LOST, total_kobo: 100000 })).toBe(100000);
    expect(receivedShare({ status: TRANSFER_LOST, total_kobo: 0 })).toBe(1);
  });
});
