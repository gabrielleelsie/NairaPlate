// Customer credit (money customers owe the business): the ONE place balances and labels are worked out.
// Each payment, write-off and correction is its own entry. Entries are never edited or deleted; a mistake is undone by a reversal
// entry (owner only, with a reason). The database enforces the same rules; this is only for showing them.
import { isOwnerRole } from "@/lib/catering-order";
import { entryWhen } from "@/lib/catering-payments";

export type Debt = {
  id: string; customer_name: string; phone: string | null; amount_kobo: number; paid_kobo: number; written_off_kobo: number;
  settled: boolean; order_id: string | null; note: string | null; created_at: string;
};
export type CreditEntry = {
  id: string; credit_id: string; kind: "payment" | "write_off" | "reversal"; amount_kobo: number; method: string | null;
  reverses_id: string | null; reason: string | null; carried_over: boolean; recorded_by_name: string | null; created_at: string;
};
export type CreditEntryView = CreditEntry & { label: string; reversed: boolean; reversedByReason: string | null };

/** The columns the credit screen reads. */
export const DEBT_COLUMNS = "id,customer_name,phone,amount_kobo,paid_kobo,written_off_kobo,settled,order_id,note,created_at";
export const ENTRY_COLUMNS = "id,credit_id,kind,amount_kobo,method,reverses_id,reason,carried_over,recorded_by_name,created_at";

export const CREDIT_ROLES = new Set(["cashier", "owner", "supa_admin"]);
export const REASON_MIN = 5;
export const reasonOk = (s: string) => s.trim().length >= REASON_MIN;

export function normaliseDebts(rows: unknown[] | null): Debt[] {
  return (rows ?? []).map((r) => {
    const x = r as Debt;
    return { ...x, amount_kobo: Number(x.amount_kobo), paid_kobo: Number(x.paid_kobo ?? 0), written_off_kobo: Number(x.written_off_kobo ?? 0) };
  });
}
export function normaliseEntries(rows: unknown[] | null): CreditEntry[] {
  return (rows ?? []).map((r) => ({ ...(r as CreditEntry), amount_kobo: Number((r as CreditEntry).amount_kobo) }));
}

/** What is still owed on one debt. Never below zero. */
export const balanceKobo = (d: Pick<Debt, "amount_kobo" | "paid_kobo" | "written_off_kobo">) =>
  Math.max(0, d.amount_kobo - d.paid_kobo - d.written_off_kobo);

/** Total still owed across debts that are not settled. */
export const totalOwed = (debts: Debt[]) => debts.filter((d) => !d.settled).reduce((s, d) => s + balanceKobo(d), 0);

export type DebtStatus = "owing" | "part_paid" | "paid" | "written_off";
/** owing: nothing paid; part paid: some paid or written off but money still owed; paid / written off: nothing left, by what closed it. */
export function debtStatus(d: Debt): DebtStatus {
  if (balanceKobo(d) > 0) return d.paid_kobo > 0 || d.written_off_kobo > 0 ? "part_paid" : "owing";
  return d.written_off_kobo > 0 ? (d.paid_kobo > 0 ? "paid" : "written_off") : "paid";
}
export const STATUS_LABEL: Record<DebtStatus, string> = { owing: "Owing", part_paid: "Part paid", paid: "Paid", written_off: "Written off" };

const KIND_LABEL = { payment: "Payment", write_off: "Written off", reversal: "Reversal" } as const;

/** Entries oldest first, each marked with whether a later reversal has undone it. */
export function describeEntries(entries: CreditEntry[]): CreditEntryView[] {
  const sorted = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.kind.localeCompare(b.kind));
  const undoneBy = new Map<string, CreditEntry>();
  for (const e of sorted) if (e.kind === "reversal" && e.reverses_id) undoneBy.set(e.reverses_id, e);
  return sorted.map((e) => ({ ...e, label: KIND_LABEL[e.kind], reversed: undoneBy.has(e.id), reversedByReason: undoneBy.get(e.id)?.reason ?? null }));
}

/** Only an owner can reverse, only a payment or a write-off, and only once. */
export const canReverse = (e: CreditEntryView, role: string | null | undefined) => isOwnerRole(role) && e.kind !== "reversal" && !e.reversed;
/** Only an owner can write off, and only while something is still owed. */
export const canWriteOff = (d: Debt, role: string | null | undefined) => isOwnerRole(role) && balanceKobo(d) > 0;
/** Owners and cashiers can take a payment, while something is still owed. */
export const canTakePayment = (d: Debt, role: string | null | undefined) => CREDIT_ROLES.has(role ?? "") && balanceKobo(d) > 0;

/** A message when the amount cannot be saved, else null. A write-off may be partial or the whole balance; so may a payment. */
export function amountProblem(kobo: number, d: Debt): string | null {
  if (!Number.isFinite(kobo) || !(kobo > 0)) return "Enter an amount more than ₦0.";
  if (kobo > balanceKobo(d)) return "That is more than the customer owes.";
  return null;
}

export const methodLabel = (m: string | null) => (m === "cash" ? "cash" : m === "transfer" ? "transfer" : "");
export const entryTime = entryWhen;
