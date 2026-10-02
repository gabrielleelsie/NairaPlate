// The ONE place supplier balances are worked out.
// Balance owed = credit purchases + reversed payments - payments - reversed credit purchases. A negative balance means the supplier owes you (an advance).
// Entries are never edited or deleted. A payment made by mistake is undone by a reversal entry (owner only, with a reason).
import { isOwnerRole } from "@/lib/catering-order";

export type SupplierTxn = {
  id: string;
  supplier_id: string;
  type: "purchase_on_credit" | "payment" | "reversal" | "purchase_reversal";
  amount_kobo: number;
  purchase_id: string | null;
  note: string | null;
  created_at: string;
  reverses_id?: string | null;
  reason?: string | null;
  recorded_by_name?: string | null;
};

/** The columns every supplier screen reads. */
export const TXN_COLUMNS = "id,supplier_id,type,amount_kobo,purchase_id,note,created_at,reverses_id,reason,recorded_by_name";

export const SUPPLIER_ROLES = new Set(["purchaser", "owner", "supa_admin"]);
export const REVERSAL_REASON_MIN = 5;
export const reasonOk = (s: string) => s.trim().length >= REVERSAL_REASON_MIN;

/** What an entry does to the balance owed: a credit purchase adds, a payment takes off, a payment reversal puts it back, a reversed credit purchase takes it off. */
export function signedAmount(t: SupplierTxn): number {
  return t.type === "payment" || t.type === "purchase_reversal" ? -t.amount_kobo : t.amount_kobo;
}

export function supplierBalance(txns: SupplierTxn[], supplierId: string): number {
  return txns.filter((t) => t.supplier_id === supplierId).reduce((s, t) => s + signedAmount(t), 0);
}

/** Newest first, each line carrying the balance owed right after it. */
export function withRunningBalance(txns: SupplierTxn[]): (SupplierTxn & { balance_after: number })[] {
  const oldestFirst = [...txns].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let bal = 0;
  const out = oldestFirst.map((t) => ({ ...t, balance_after: (bal += signedAmount(t)) }));
  return out.reverse();
}

export function normaliseTxns(rows: unknown[] | null): SupplierTxn[] {
  return (rows ?? []).map((r) => {
    const x = r as SupplierTxn;
    return { ...x, amount_kobo: Number(x.amount_kobo) };
  });
}

/** For each payment, whether a later reversal has undone it (and why). */
export function reversalOf(txns: SupplierTxn[]): Map<string, SupplierTxn> {
  const m = new Map<string, SupplierTxn>();
  for (const t of txns) if ((t.type === "reversal" || t.type === "purchase_reversal") && t.reverses_id) m.set(t.reverses_id, t);
  return m;
}

/** Only an owner can reverse, only a payment, and only once. */
export function canReverse(t: SupplierTxn, role: string | null | undefined, undone: Map<string, SupplierTxn>): boolean {
  return isOwnerRole(role) && t.type === "payment" && !undone.has(t.id);
}

/** What the person is told before a payment bigger than the balance owed is saved, or null when it needs no warning. */
export function advanceWarning(balanceOwedKobo: number, paymentKobo: number): { extraKobo: number } | null {
  if (!(paymentKobo > 0)) return null;
  const extra = paymentKobo - Math.max(0, balanceOwedKobo);
  return extra > 0 ? { extraKobo: extra } : null;
}

/** "You owe them ₦X" or "They owe you ₦X" with the wording the screen uses. */
export function balanceWords(balanceKobo: number, format: (k: number) => string): string {
  if (balanceKobo > 0) return `You owe them ${format(balanceKobo)}`;
  if (balanceKobo < 0) return `They owe you ${format(-balanceKobo)}`;
  return "You owe them nothing";
}
