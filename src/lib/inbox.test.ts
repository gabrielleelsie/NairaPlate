import { describe, expect, it } from "vitest";
import { buildInbox, summarise } from "./inbox";

const now = new Date("2026-10-05T12:00:00Z");
const empty = { now, lateEntries: [], payouts: [], openDrawers: [], flags: [], attention: [], stale: [] };
const pay = (o: Record<string, unknown>) => ({ amount_kobo: 50000, category: "transport", note: "fuel run", recorded_by_name: "Ada", created_at: "2026-10-05T09:00:00Z", approves_id: null, reverses_id: null, ...o }) as never;

describe("inbox", () => {
  it("is empty when nothing needs attention", () => {
    expect(buildInbox(empty)).toEqual([]);
    expect(summarise([])).toEqual({ approval: 0, cash: 0, stock: 0, system: 0 });
  });
  it("shows only unsettled cash requests", () => {
    const items = buildInbox({ ...empty, payouts: [pay({ id: "r1", kind: "request" }), pay({ id: "r2", kind: "request" }), pay({ id: "a1", kind: "payout", approves_id: "r1" })] });
    expect(items.map((i) => i.key)).toEqual(["payout:r2"]);
  });
  it("shows pending paper sales but not posted ones; closed-shift review is high", () => {
    const items = buildInbox({ ...empty, lateEntries: [
      { id: "1", paper_reference: "P1", status: "submitted", actual_sold_at: "2026-10-04T10:00:00Z", cash_kobo: 100, transfer_kobo: 0 },
      { id: "2", paper_reference: "P2", status: "posted", actual_sold_at: "2026-10-04T10:00:00Z", cash_kobo: 100, transfer_kobo: 0 },
      { id: "3", paper_reference: "P3", status: "needs_shift_review", actual_sold_at: "2026-10-04T09:00:00Z", cash_kobo: 100, transfer_kobo: 0 },
    ] });
    expect(items.map((i) => i.key)).toEqual(["late:3", "late:1"]);
  });
  it("flags shifts open longer than 18 hours only", () => {
    const items = buildInbox({ ...empty, openDrawers: [{ id: "old", opened_at: "2026-10-04T10:00:00Z" }, { id: "new", opened_at: "2026-10-05T08:00:00Z" }] });
    expect(items.map((i) => i.key)).toEqual(["drawer:old"]);
  });
  it("routes flags to the right category and keeps them seen-able", () => {
    const items = buildInbox({ ...empty, flags: [
      { id: "f1", flag_type: "drawer_variance", severity: "critical", message: "short", created_at: "2026-10-05T01:00:00Z" },
      { id: "f2", flag_type: "low_stock", severity: "warn", message: "rice", created_at: "2026-10-05T02:00:00Z" },
      { id: "f3", flag_type: "payment_keys", severity: "critical", message: "keys", created_at: "2026-10-05T03:00:00Z" },
    ] });
    expect(summarise(items)).toEqual({ approval: 0, cash: 1, stock: 1, system: 1 });
    expect(items.every((i) => i.flagId)).toBe(true);
  });
});
