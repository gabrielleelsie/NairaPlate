// Cash paid out of the drawer: the ONE place the limit rule, the entry states and the labels are worked out.
// Every payout is an entry on one shift. Entries are never edited or deleted. A request is settled by a new entry that points at it
// (an approval or a decline), and an owner cancels a payout with a reversal. The database enforces the same rules; this is only for showing them.
import { isOwnerRole } from "@/lib/catering-order";

export const REASON_MIN = 5;
export const noteOk = (s: string) => s.trim().length >= REASON_MIN;

/** The limit a cashier may take out in total on one shift without asking, until the owner sets another. ₦10,000. */
export const DEFAULT_PAYOUT_LIMIT_KOBO = 1_000_000;

/** Categories a person can pick. "purchase" and "supplier_payment" are written by the "Paid from the cash drawer" boxes. */
export const PAYOUT_CATEGORIES = [
  { value: "market_run", label: "Market run" },
  { value: "gas_fuel", label: "Gas or fuel" },
  { value: "transport", label: "Transport" },
  { value: "supplier_settlement", label: "Supplier settlement" },
  { value: "other", label: "Other" },
] as const;
const CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(PAYOUT_CATEGORIES.map((c) => [c.value, c.label])),
  purchase: "Purchase", supplier_payment: "Supplier payment",
};
export const categoryLabel = (c: string | null | undefined) => (c ? CATEGORY_LABEL[c] ?? c.replaceAll("_", " ") : "");

export type PayoutRow = {
  id: string; drawer_id: string; kind: "payout" | "request" | "decline" | "reversal"; amount_kobo: number; category: string; note: string;
  reverses_id: string | null; approves_id: string | null; purchase_id: string | null; supplier_txn_id: string | null;
  recorded_by: string | null; recorded_by_role: string | null; recorded_by_name: string | null; created_at: string;
};
export const PAYOUT_COLUMNS = "id,drawer_id,kind,amount_kobo,category,note,reverses_id,approves_id,purchase_id,supplier_txn_id,recorded_by,recorded_by_role,recorded_by_name,created_at";

export function normalisePayouts(rows: unknown[] | null): PayoutRow[] {
  return (rows ?? []).map((r) => ({ ...(r as PayoutRow), amount_kobo: Number((r as PayoutRow).amount_kobo) }));
}

/** Who may take cash out of an open shift: cashiers (within the limit) and owners. Others only through the "Paid from the cash drawer" boxes. */
export const canTakeCashOut = (role: string | null | undefined) => role === "cashier" || isOwnerRole(role);
export const canDecide = (role: string | null | undefined) => isOwnerRole(role);

const settledIds = (rows: PayoutRow[]) => new Set(rows.filter((r) => r.approves_id || r.reverses_id).map((r) => (r.approves_id ?? r.reverses_id)!));

/** Cash that left the drawer on this shift: payouts minus reversals. Requests and declines do not count. */
export const netPayoutsKobo = (rows: PayoutRow[]) => rows.filter((r) => r.kind === "payout" || r.kind === "reversal").reduce((s, r) => s + r.amount_kobo, 0);

/** Requests nobody has decided yet. A shift cannot close while any exist. */
export const pendingRequests = (rows: PayoutRow[]) => { const done = settledIds(rows); return rows.filter((r) => r.kind === "request" && !done.has(r.id)); };

/** What a cashier has taken out directly on this shift, not counting reversed payouts and anything an owner approved or entered. */
export function cashierDirectTotalKobo(rows: PayoutRow[]): number {
  const reversed = new Set(rows.filter((r) => r.kind === "reversal" && r.reverses_id).map((r) => r.reverses_id!));
  return rows.filter((r) => r.kind === "payout" && !r.approves_id && r.recorded_by_role === "cashier" && !["purchase", "supplier_payment"].includes(r.category) && !reversed.has(r.id))
    .reduce((s, r) => s + r.amount_kobo, 0);
}

export type PayoutChoice = "direct" | "request" | "invalid";
/** What happens when this person enters this amount. Owners: always direct. Cashiers: direct while the shift's running total stays within the limit. */
export function classifyPayout(o: { role: string | null | undefined; limitKobo: number; directTotalKobo: number; amountKobo: number }): PayoutChoice {
  if (!(o.amountKobo > 0) || !canTakeCashOut(o.role)) return "invalid";
  if (isOwnerRole(o.role)) return "direct";
  return o.directTotalKobo + o.amountKobo <= o.limitKobo ? "direct" : "request";
}
/** How much a cashier can still take out without asking. */
export const remainingAllowanceKobo = (limitKobo: number, directTotalKobo: number) => Math.max(0, limitKobo - directTotalKobo);

export type PayoutStatus = "recorded" | "reversed" | "waiting" | "approved" | "declined";
export type PayoutView = PayoutRow & { status: PayoutStatus; settledBy: string | null; settledNote: string | null; settledAt: string | null };

/** Entries as the owner reads them: payouts and requests, each with what happened to it. Decline, approval and reversal rows are not listed on their own. */
export function payoutViews(rows: PayoutRow[]): PayoutView[] {
  const settle = new Map<string, PayoutRow>();
  for (const r of rows) if (r.approves_id) settle.set(r.approves_id, r); else if (r.reverses_id) settle.set(r.reverses_id, r);
  return rows.filter((r) => r.kind === "payout" || r.kind === "request").filter((r) => !r.approves_id).map((r) => {
    const s = settle.get(r.id);
    let status: PayoutStatus = r.kind === "payout" ? "recorded" : "waiting";
    if (s) status = r.kind === "payout" ? "reversed" : s.kind === "decline" ? "declined" : "approved";
    return { ...r, status, settledBy: s?.recorded_by_name ?? null, settledNote: s?.kind === "payout" ? null : s?.note ?? null, settledAt: s?.created_at ?? null };
  });
}

export const canReversePayout = (role: string | null | undefined, v: { kind: string; status: PayoutStatus }) => canDecide(role) && v.kind === "payout" && v.status === "recorded";

export const STATUS_LABEL: Record<PayoutStatus, string> = { recorded: "Recorded", reversed: "Reversed", waiting: "Waiting for the owner", approved: "Approved", declined: "Declined" };

/** Plain sentences for what the database says when it refuses. */
export function friendlyPayoutError(message: string): string {
  if (/waiting for the owner/i.test(message)) return "A cash payout is waiting for the owner. Ask them to approve or decline it, then close the shift.";
  if (/no open shift/i.test(message)) return "There is no open shift. Open a shift first.";
  return message;
}
