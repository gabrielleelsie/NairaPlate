import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/external-supabase", () => ({ supabase: {} }));
import { fileProblem, fitSize, receiptPath, receiptRoleAllowed } from "./receipt-capture";

describe("receipt capture", () => {
  it("roles match the database rule", () => {
    expect(receiptRoleAllowed("owner", "purchase")).toBe(true);
    expect(receiptRoleAllowed("purchaser", "late_entry")).toBe(false);
    expect(receiptRoleAllowed("purchaser", "supplier_payment")).toBe(true);
    expect(receiptRoleAllowed("cashier", "payout")).toBe(true);
    expect(receiptRoleAllowed("cashier", "purchase")).toBe(false);
    expect(receiptRoleAllowed("cook", "payout")).toBe(false);
  });
  it("rejects non-images and big files", () => {
    expect(fileProblem({ type: "application/pdf", size: 10 })).toMatch(/photo/);
    expect(fileProblem({ type: "image/jpeg", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(fileProblem({ type: "image/png", size: 1000 })).toBeNull();
  });
  it("shrinks to 1600 on the long side, never enlarges", () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("builds the only path shape the database accepts", () => {
    const p = receiptPath("biz1", "payout", "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222");
    expect(p).toMatch(/^biz1\/payout\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
  });
});
