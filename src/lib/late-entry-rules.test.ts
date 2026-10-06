import { describe, expect, it } from "vitest";
import { approvalArgs, approvalProblem, awaitingTransfer, canMarkLost, isTransferLost, lostProblem, RESOLUTION_LABEL, shiftSituation, transferProblem } from "./late-entry-rules";

const withShift = { source_shift_id: "s1", status: "submitted" };
describe("shiftSituation", () => {
  it("is outside when the sale had no shift", () => { expect(shiftSituation({ source_shift_id: null, status: "needs_shift_review" }, undefined)).toBe("outside"); });
  it("follows the real shift's status, not the entry's old status", () => {
    expect(shiftSituation(withShift, "open")).toBe("open");
    expect(shiftSituation(withShift, "closed")).toBe("closed"); // closed after the entry was sent
    expect(shiftSituation({ ...withShift, status: "needs_shift_review" }, "closed")).toBe("closed");
  });
  it("falls back to the entry's status when the shift cannot be read", () => {
    expect(shiftSituation(withShift, undefined)).toBe("open");
    expect(shiftSituation({ ...withShift, status: "needs_shift_review" }, undefined)).toBe("closed");
  });
});

describe("approvalProblem and approvalArgs", () => {
  it("needs nothing for an open shift", () => {
    expect(approvalProblem("open", "", "")).toBeNull();
    expect(approvalArgs("open", "", "")).toEqual({ p_shift_resolution: null, p_notes: null });
  });
  it("needs a reason of 5 characters for cash outside any shift, and sends outside_shift_cash", () => {
    expect(approvalProblem("outside", "", "abcd")).toMatch(/at least 5/);
    expect(approvalProblem("outside", "", "  Night sale  ")).toBeNull();
    expect(approvalArgs("outside", "", "  Night sale  ")).toEqual({ p_shift_resolution: "outside_shift_cash", p_notes: "Night sale" });
  });
  it("needs a choice and a reason for a closed shift", () => {
    expect(approvalProblem("closed", "", "good reason")).toMatch(/Choose/);
    expect(approvalProblem("closed", "closed_shift_included", "abc")).toMatch(/at least 5/);
    expect(approvalProblem("closed", "closed_shift_late_cash", "Cash not counted")).toBeNull();
    expect(approvalArgs("closed", "closed_shift_late_cash", " Cash not counted ")).toEqual({ p_shift_resolution: "closed_shift_late_cash", p_notes: "Cash not counted" });
  });
  it("does not accept a choice that is not one of the two closed-shift answers", () => {
    expect(approvalProblem("closed", "outside_shift_cash", "good reason")).toMatch(/Choose/);
  });
});

describe("transfer confirmation", () => {
  it("needs proof and a reason, 5 characters each", () => {
    expect(transferProblem("abc", "Customer paid")).toMatch(/proof/);
    expect(transferProblem("UBA ref 123456", "abc")).toMatch(/reason/);
    expect(transferProblem(" UBA ref 123456 ", " Customer paid at 3pm ")).toBeNull();
  });
  it("finds a posted paper sale that still waits for its transfer", () => {
    expect(awaitingTransfer({ status: "posted", transfer_kobo: 50000 }, "awaiting_payment")).toBe(true);
    expect(awaitingTransfer({ status: "posted", transfer_kobo: "50000" }, "awaiting_payment")).toBe(true);
    expect(awaitingTransfer({ status: "posted", transfer_kobo: 50000 }, "paid")).toBe(false);
    expect(awaitingTransfer({ status: "posted", transfer_kobo: 0 }, "awaiting_payment")).toBe(false);
    expect(awaitingTransfer({ status: "rejected", transfer_kobo: 50000 }, undefined)).toBe(false);
  });
  it("labels every way a paper sale can be resolved", () => {
    for (const k of ["open_shift_direct", "closed_shift_included", "closed_shift_late_cash", "outside_shift_cash"]) expect(RESOLUTION_LABEL[k]).toBeTruthy();
  });
});

describe("transfer lost", () => {
  it("needs a reason of 10 characters", () => {
    expect(lostProblem("too short")).toMatch(/at least 10/);
    expect(lostProblem("  Customer never paid, 3 days  ")).toBeNull();
  });
  it("applies only to a split sale that still waits for its transfer and has cash taken", () => {
    const split = { status: "posted", cash_kobo: 50000, transfer_kobo: 50000 };
    expect(canMarkLost(split, "awaiting_payment")).toBe(true);
    expect(canMarkLost({ ...split, cash_kobo: "50000" }, "awaiting_payment")).toBe(true);
    expect(canMarkLost({ ...split, cash_kobo: 0 }, "awaiting_payment")).toBe(false); // transfer-only: cancel instead
    expect(canMarkLost(split, "paid")).toBe(false);
    expect(canMarkLost(split, "transfer_lost")).toBe(false);
    expect(canMarkLost({ ...split, status: "rejected" }, undefined)).toBe(false);
  });
  it("recognises a sale closed as transfer lost, and it no longer waits for a transfer", () => {
    const split = { status: "posted", cash_kobo: 50000, transfer_kobo: 50000 };
    expect(isTransferLost(split, "transfer_lost")).toBe(true);
    expect(isTransferLost(split, "awaiting_payment")).toBe(false);
    expect(awaitingTransfer(split, "transfer_lost")).toBe(false);
  });
});
