import { describe, expect, it } from "vitest";
import { buildQueuedSale, countWaiting, offlinePayAllowed } from "./offline-sales";

const base = { clientSaleId: "c1", businessId: "b", userId: "u", nowIso: "2026-11-16T10:00:00Z", paperReference: "B-1", channel: "Walk-in", tier: "Standard", lines: [{ recipe_id: "r1", quantity: 2 }], shownTotalKobo: 300000 };

describe("offline sales rules", () => {
  it("allows only cash and credit", () => {
    expect(offlinePayAllowed("cash")).toBe(true);
    expect(offlinePayAllowed("credit")).toBe(true);
    for (const p of ["transfer", "split", "auto_transfer"] as const) expect(offlinePayAllowed(p)).toBe(false);
  });
  it("refuses a transfer sale", () => { expect(buildQueuedSale({ ...base, pay: "transfer" })).toBeNull(); });
  it("refuses empty or zero sales", () => {
    expect(buildQueuedSale({ ...base, pay: "cash", lines: [] })).toBeNull();
    expect(buildQueuedSale({ ...base, pay: "cash", shownTotalKobo: 0 })).toBeNull();
  });
  it("keeps a cash sale without customer details", () => {
    const s = buildQueuedSale({ ...base, pay: "cash", custName: "Ada", custPhone: "080" })!;
    expect(s.status).toBe("waiting");
    expect(s.custName).toBeUndefined();
    expect(s.custPhone).toBeUndefined();
  });
  it("needs a name and phone for credit", () => {
    expect(buildQueuedSale({ ...base, pay: "credit" })).toBeNull();
    expect(buildQueuedSale({ ...base, pay: "credit", custName: " Ada ", custPhone: "080" })!.custName).toBe("Ada");
  });
  it("counts only sales still waiting", () => {
    const w = buildQueuedSale({ ...base, pay: "cash" })!;
    expect(countWaiting([w, { ...w, status: "sent" }, { ...w, status: "failed" }])).toBe(1);
  });
});
