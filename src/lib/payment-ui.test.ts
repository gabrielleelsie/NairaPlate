import { describe, expect, it } from "vitest";
import { LONG_WAIT_MS, payChoicesFor, waitState } from "./payment-ui";

describe("payChoicesFor", () => {
  it("manual keeps today's four choices", () => expect(payChoicesFor("manual")).toEqual(["cash", "transfer", "split", "credit"]));
  it("no setting behaves as manual", () => { expect(payChoicesFor(null)).toEqual(["cash", "transfer", "split", "credit"]); expect(payChoicesFor(undefined)).toHaveLength(4); });
  it("cash only removes every transfer choice", () => expect(payChoicesFor("cash_only")).toEqual(["cash", "credit"]));
  it("automatic removes typed transfer and split, adds the automatic one", () => expect(payChoicesFor("automatic")).toEqual(["cash", "auto_transfer", "credit"]));
});

describe("waitState", () => {
  const base = { amount_kobo: 200000, paid_amount_kobo: null, created_at: "2026-10-01T10:00:00Z" };
  const t0 = new Date("2026-10-01T10:00:00Z").getTime();
  it("waits, then prompts after ten minutes", () => {
    expect(waitState({ ...base, status: "waiting" }, new Date(t0 + 60_000)).kind).toBe("waiting");
    expect(waitState({ ...base, status: "waiting" }, new Date(t0 + LONG_WAIT_MS + 1)).kind).toBe("long_wait");
  });
  it("shows how much is still owed on a short payment", () => {
    expect(waitState({ ...base, status: "short", paid_amount_kobo: 60000 })).toEqual({ kind: "short", short_by_kobo: 140000 });
  });
  it("paid and cancelled are final", () => {
    expect(waitState({ ...base, status: "paid", paid_amount_kobo: 200000 }).kind).toBe("paid");
    expect(waitState({ ...base, status: "cancelled" }).kind).toBe("cancelled");
  });
});
