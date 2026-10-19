import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownPlanMode, setupFeePaid, verifyOwnerEmail } from "./subscribe-identity.server";

// A tiny stand-in for the database client: each table answers with the rows it is given, and the filters used are recorded.
type Rows = Record<string, unknown[]>;
function fake(rows: Rows, log: string[] = []): SupabaseClient {
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = new Proxy(q, {
      get: (_t, prop: string) => {
        if (prop === "then") return undefined;
        if (prop === "maybeSingle") return () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
        // limit() can be awaited on its own (a list) or followed by maybeSingle() (one row), like the real client.
        if (prop === "limit")
          return () => {
            const list = Promise.resolve({ data: rows[table] ?? [], error: null });
            return Object.assign(list, { maybeSingle: () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }) });
          };
        return (...args: unknown[]) => { log.push(`${table}.${prop}(${args.join(",")})`); return chain; };
      },
    });
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

describe("verifyOwnerEmail", () => {
  const owner = { id: "o1" };
  it("passes for an owner email on a waiting, approved or suspended store", async () => {
    for (const status of ["pending", "approved", "suspended"]) {
      const r = await verifyOwnerEmail(fake({ staff_users: [owner], businesses: [{ id: "ada", name: "Ada Kitchen", status }] }), " Ada ", " Ada@X.com ");
      expect(r).toEqual({ ok: true, businessId: "ada", businessName: "Ada Kitchen", status, email: "ada@x.com" });
    }
  });
  it("fails when no owner has that email on that store", async () => {
    expect(await verifyOwnerEmail(fake({ staff_users: [], businesses: [{ id: "ada", name: "A", status: "approved" }] }), "ada", "ada@x.com")).toEqual({ ok: false });
  });
  it("fails for a rejected store", async () => {
    expect(await verifyOwnerEmail(fake({ staff_users: [owner], businesses: [{ id: "ada", name: "A", status: "rejected" }] }), "ada", "ada@x.com")).toEqual({ ok: false });
  });
  it("fails for a missing store, a bad email or an empty code, without asking the database", async () => {
    const log: string[] = [];
    expect(await verifyOwnerEmail(fake({ staff_users: [owner], businesses: [] }, log), "ada", "ada@x.com")).toEqual({ ok: false });
    expect(await verifyOwnerEmail(fake({}, log), "ada", "not-an-email")).toEqual({ ok: false });
    expect(await verifyOwnerEmail(fake({}, log), "  ", "ada@x.com")).toEqual({ ok: false });
  });
  it("looks only at active owners, and matches the email exactly (wildcards escaped)", async () => {
    const log: string[] = [];
    await verifyOwnerEmail(fake({ staff_users: [owner], businesses: [{ id: "a", name: "A", status: "approved" }] }, log), "a", "a_b@x.com");
    expect(log).toContain("staff_users.eq(role,owner)");
    expect(log).toContain("staff_users.eq(is_active,true)");
    expect(log).toContain("staff_users.ilike(email,a\\_b@x.com)");
  });
});

describe("setupFeePaid", () => {
  it("is true for an approved Selar setup payment", async () => expect(await setupFeePaid(fake({ selar_payments: [{ id: "s" }], subscription_payments: [] }), "ada")).toBe(true));
  it("is true when a recorded payment included the setup fee", async () => expect(await setupFeePaid(fake({ selar_payments: [], subscription_payments: [{ id: "p" }] }), "ada")).toBe(true));
  it("is false when neither exists", async () => expect(await setupFeePaid(fake({ selar_payments: [], subscription_payments: [] }), "ada")).toBe(false));
});

// A stand-in for the database client that answers the one question ownPlanMode asks.
const fakeOne = (row: unknown, error: unknown = null) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }) }) as unknown as SupabaseClient;

describe("ownPlanMode", () => {
  it("gives the plan type of an approved or suspended store", async () => {
    expect(await ownPlanMode(fakeOne({ status: "approved", operating_mode: "standard" }), "x")).toBe("standard");
    expect(await ownPlanMode(fakeOne({ status: "suspended", operating_mode: "buka" }), "x")).toBe("buka");
    expect(await ownPlanMode(fakeOne({ status: "approved", operating_mode: "advanced" }), "x")).toBe("advanced");
  });
  it("gives nothing for a store still waiting, so every plan is shown", async () => {
    expect(await ownPlanMode(fakeOne({ status: "pending", operating_mode: "advanced" }), "x")).toBeNull();
  });
  it("gives nothing when the plan type is missing or unknown, or the store cannot be read", async () => {
    expect(await ownPlanMode(fakeOne({ status: "approved", operating_mode: null }), "x")).toBeNull();
    expect(await ownPlanMode(fakeOne({ status: "approved", operating_mode: "gold" }), "x")).toBeNull();
    expect(await ownPlanMode(fakeOne(null), "x")).toBeNull();
    expect(await ownPlanMode(fakeOne(null, { message: "no such column" }), "x")).toBeNull();
  });
});
