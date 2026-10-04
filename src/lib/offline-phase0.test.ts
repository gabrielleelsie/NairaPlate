import { describe, expect, it } from "vitest";
import { heartbeatDelayMs, initialConnState, nextConnState } from "./connectivity";
import { businessCode, isDraftExpired, paperReference, sanitizeDraft, tillCode, type PosDraft } from "./pos-draft";

const T = "2026-10-04T10:00:00.000Z";

describe("connection states", () => {
  it("one failure only means checking; two means offline", () => {
    let s = nextConnState(initialConnState(T), "ping_ok", T);
    expect(s.status).toBe("online");
    s = nextConnState(s, "ping_fail", T);
    expect(s.status).toBe("checking");
    s = nextConnState(s, "ping_fail", T);
    expect(s.status).toBe("offline");
    expect(s.outageStartedAtUtc).toBe(T);
  });
  it("browser coming back online is not enough; only a good check makes it online", () => {
    let s = { ...initialConnState(T), status: "offline" as const, consecutiveFails: 3 };
    s = nextConnState(s, "browser_online", T);
    expect(s.status).toBe("checking");
    s = nextConnState(s, "ping_ok", T);
    expect(s.status).toBe("online");
    expect(s.outageStartedAtUtc).toBeNull();
  });
  it("a failed request drops online to checking at once", () => {
    const s = nextConnState({ ...initialConnState(T), status: "online" }, "request_fail", T);
    expect(s.status).toBe("checking");
  });
  it("browser offline plus a failed check is offline", () => {
    let s = nextConnState({ ...initialConnState(T), status: "online" }, "browser_offline", T);
    s = nextConnState(s, "ping_fail", T);
    expect(s.status).toBe("offline");
  });
  it("checks slow down when hidden and back off after failures", () => {
    expect(heartbeatDelayMs("online", false, 0)).toBe(25_000);
    expect(heartbeatDelayMs("online", true, 0)).toBe(90_000);
    expect(heartbeatDelayMs("checking", false, 1)).toBe(5_000);
    expect(heartbeatDelayMs("offline", false, 2)).toBe(10_000);
    expect(heartbeatDelayMs("offline", false, 9)).toBe(30_000);
  });
});

const base: PosDraft = {
  key: "b:u", clientSaleId: "x", lines: [{ recipe_id: "r", quantity: 1 }], channel: "Walk-in", aggName: "", tier: "Standard",
  pay: "cash", cashN: "", trN: "", custName: "Ada", custPhone: "080", state: "editing", updatedAtUtc: T,
};

describe("drafts", () => {
  it("keeps customer details for credit drafts only", () => {
    expect(sanitizeDraft(base).custName).toBeUndefined();
    expect(sanitizeDraft(base).custPhone).toBeUndefined();
    expect(sanitizeDraft({ ...base, pay: "credit" }).custPhone).toBe("080");
  });
  it("expires after 24 hours", () => {
    expect(isDraftExpired(base, Date.parse(T) + 23 * 3600_000)).toBe(false);
    expect(isDraftExpired(base, Date.parse(T) + 25 * 3600_000)).toBe(true);
  });
});

describe("paper reference", () => {
  it("formats business, date, till and sequence", () => {
    expect(businessCode("demo-kitchen")).toBe("DK");
    expect(tillCode("Till 1 — Counter")).toBe("T1");
    expect(paperReference("demo-kitchen", "2026-10-04", "Till 1 — Counter", 7)).toBe("DK-20261004-T1-007");
  });
});
