import { describe, expect, it } from "vitest";
import { canCorrect, canReverse, friendlyReversalError, netTotal, pairReversals, priceReversalNote, reasonOk, standingEntries, type Correctable } from "./corrections";

type Row = Correctable & { net: number };
const row = (o: Partial<Row>): Row => ({ id: "p1", kind: "entry", reverses_id: null, reason: null, recorded_by_name: null, created_at: "2026-10-03T10:00:00Z", net: 900000, ...o });

describe("reason rule", () => {
  it("needs 5 or more characters after trimming", () => {
    expect(reasonOk("abcd")).toBe(false);
    expect(reasonOk("  abcd  ")).toBe(false);
    expect(reasonOk("abcde")).toBe(true);
    expect(reasonOk("")).toBe(false);
  });
});

describe("who can correct", () => {
  it("is owners and supa admins only", () => {
    expect(canCorrect("owner")).toBe(true);
    expect(canCorrect("supa_admin")).toBe(true);
    for (const r of ["cashier", "purchaser", "cook", "platform_admin", null, undefined]) expect(canCorrect(r)).toBe(false);
  });
  it("offers Reverse only on a standing entry", () => {
    expect(canReverse("owner", { kind: "entry", reversed: false })).toBe(true);
    expect(canReverse("owner", { kind: "entry", reversed: true })).toBe(false);
    expect(canReverse("owner", { kind: "reversal", reversed: false })).toBe(false);
    expect(canReverse("cook", { kind: "entry", reversed: false })).toBe(false);
  });
});

describe("pairing a reversal with its entry", () => {
  const rows = [
    row({ id: "r1", kind: "reversal", reverses_id: "p1", reason: "wrong week", recorded_by_name: "Owner One", net: -900000, created_at: "2026-10-03T11:00:00Z" }),
    row({ id: "p2", net: 500000 }),
    row({ id: "p1" }),
  ];
  it("hides the reversal row and marks the original", () => {
    const out = pairReversals(rows);
    expect(out.map((r) => r.id)).toEqual(["p2", "p1"]);
    const p1 = out.find((r) => r.id === "p1")!;
    expect(p1.reversed).toBe(true); expect(p1.reversalReason).toBe("wrong week"); expect(p1.reversedBy).toBe("Owner One"); expect(p1.reversedAt).toBe("2026-10-03T11:00:00Z");
    expect(out.find((r) => r.id === "p2")!.reversed).toBe(false);
  });
  it("keeps only standing entries for totals", () => {
    expect(standingEntries(rows).map((r) => r.id)).toEqual(["p2"]);
  });
  it("nets a reversed pair to zero when everything is summed", () => {
    expect(netTotal(rows, (r) => r.net)).toBe(500000);
    expect(netTotal(rows.filter((r) => r.id !== "p2"), (r) => r.net)).toBe(0);
  });
  it("treats rows from before reversals existed (no kind) as ordinary entries", () => {
    const old = [row({ kind: null }), row({ id: "p9", kind: null })];
    expect(pairReversals(old)).toHaveLength(2);
  });
});

describe("price decision note", () => {
  const fmt = (k: number) => `N${k / 100}`;
  it("says the price goes back for a published decision", () => {
    expect(priceReversalNote({ decision: "publish", previous_price_kobo: 100000 }, fmt)).toContain("N1000");
  });
  it("says only the record is reversed for other decisions", () => {
    expect(priceReversalNote({ decision: "defer", previous_price_kobo: 100000 }, fmt)).toContain("only the record");
  });
});

describe("database messages", () => {
  it("are turned into plain sentences", () => {
    expect(friendlyReversalError("Cannot be reversed because the dish price has changed since this decision.")).toContain("price has changed");
    expect(friendlyReversalError("This payout has already been reversed.")).toBe("This has already been reversed.");
    expect(friendlyReversalError("something else")).toBe("something else");
  });
});
