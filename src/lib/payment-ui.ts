// What the Till shows for payments. Pure, so it can be tested.
import type { PaymentMode } from "@/lib/payments";

export type PayChoice = "cash" | "transfer" | "split" | "credit" | "auto_transfer";

/** Which payment choices a cashier sees, by the shop's mode. */
export function payChoicesFor(mode: PaymentMode | null | undefined): PayChoice[] {
  if (mode === "automatic") return ["cash", "auto_transfer", "credit"];
  if (mode === "cash_only") return ["cash", "credit"];
  return ["cash", "transfer", "split", "credit"];
}

export const PAY_CHOICE_LABEL: Record<PayChoice, string> = {
  cash: "Cash", transfer: "Transfer", split: "Split", credit: "Customer credit (owe)", auto_transfer: "Transfer (automatic)",
};

export type RequestRow = { status: "waiting" | "paid" | "short" | "cancelled"; amount_kobo: number; paid_amount_kobo: number | null; created_at: string };
export type WaitState = { kind: "paid" | "cancelled" | "waiting" | "long_wait" | "short"; short_by_kobo: number };

export const LONG_WAIT_MS = 10 * 60 * 1000;

export function waitState(r: RequestRow, now: Date = new Date()): WaitState {
  if (r.status === "paid") return { kind: "paid", short_by_kobo: 0 };
  if (r.status === "cancelled") return { kind: "cancelled", short_by_kobo: 0 };
  const short = r.status === "short" ? Math.max(0, Number(r.amount_kobo) - Number(r.paid_amount_kobo ?? 0)) : 0;
  if (r.status === "short") return { kind: "short", short_by_kobo: short };
  return { kind: now.getTime() - new Date(r.created_at).getTime() > LONG_WAIT_MS ? "long_wait" : "waiting", short_by_kobo: 0 };
}
