// The ONE place supplier balances are worked out.
// Balance owed = SUM(purchase_on_credit) − SUM(payment).
export type SupplierTxn = {
  id: string;
  supplier_id: string;
  type: "purchase_on_credit" | "payment";
  amount_kobo: number;
  purchase_id: string | null;
  note: string | null;
  created_at: string;
};

export const SUPPLIER_ROLES = new Set(["purchaser", "owner", "supa_admin"]);

export function signedAmount(t: SupplierTxn): number {
  return t.type === "purchase_on_credit" ? t.amount_kobo : -t.amount_kobo;
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
