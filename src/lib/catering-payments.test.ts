import { describe, expect, it } from "vitest";
import { canReverse, describeEntries, netReceived, reasonOk, type PaymentEntry } from "@/lib/catering-payments";

const e = (o: Partial<PaymentEntry> & Pick<PaymentEntry, "id" | "kind" | "amount_kobo" | "created_at">): PaymentEntry =>
  ({ order_id: "o1", method: null, reverses_id: null, reason: null, carried_over: false, recorded_by_name: "Cash Cashier", ...o });

const history = [
  e({ id: "d", kind: "deposit", amount_kobo: 200000, created_at: "2026-10-01T10:00:00Z" }),
  e({ id: "p1", kind: "payment", amount_kobo: 500000, method: "transfer", created_at: "2026-10-02T10:00:00Z" }),
  e({ id: "r1", kind: "reversal", amount_kobo: -500000, reverses_id: "p1", reason: "customer asked for a refund", created_at: "2026-10-02T11:00:00Z" }),
  e({ id: "p2", kind: "payment", amount_kobo: 100000, method: "cash", created_at: "2026-10-03T10:00:00Z" }),
];

describe("describeEntries", () => {
  it("lists oldest first and marks an undone payment as reversed", () => {
    const v = describeEntries([...history].reverse());
    expect(v.map((x) => x.id)).toEqual(["d", "p1", "r1", "p2"]);
    expect(v.find((x) => x.id === "p1")?.reversed).toBe(true);
    expect(v.find((x) => x.id === "p1")?.reversedByReason).toBe("customer asked for a refund");
    expect(v.find((x) => x.id === "p2")?.reversed).toBe(false);
    expect(v.find((x) => x.id === "r1")?.label).toBe("Reversal");
  });
});

describe("netReceived", () => {
  it("is the sum of every entry, so a reversal takes its payment back out", () => {
    expect(netReceived(history)).toBe(300000);
    expect(netReceived([])).toBe(0);
  });
});

describe("canReverse", () => {
  const v = describeEntries(history);
  const get = (id: string) => v.find((x) => x.id === id)!;
  it("lets an owner reverse a live deposit or payment", () => {
    expect(canReverse(get("d"), "owner")).toBe(true);
    expect(canReverse(get("p2"), "supa_admin")).toBe(true);
  });
  it("never lets a cashier, and never a reversal or an already reversed payment", () => {
    expect(canReverse(get("p2"), "cashier")).toBe(false);
    expect(canReverse(get("r1"), "owner")).toBe(false);
    expect(canReverse(get("p1"), "owner")).toBe(false);
  });
});

describe("reasonOk", () => {
  it("needs 5 or more characters once trimmed", () => {
    expect(reasonOk("no")).toBe(false);
    expect(reasonOk("    ab  ")).toBe(false);
    expect(reasonOk("wrong booking")).toBe(true);
  });
});
