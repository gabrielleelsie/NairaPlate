// Purchases: the ONE place that decides what a purchase line means after reversals, and whether an owner may reverse it.
// A purchase is never edited. A mistake is undone by a reversal entry (owner only, with a reason). The database enforces every rule here;
// this is only for showing them.
import { isOwnerRole } from "@/lib/catering-order";

export type BeforeState = { cost_kobo: number | null; grade: string | null; season: string | null } | null;

export type PurchaseRow = {
  id: string; ingredient_id: string; qty: number; market_unit: string; total_kobo: number; payment_method: string | null; recorded_at: string;
  grade: string | null; season: string | null; raw_transcript?: string | null; supplier_id?: string | null;
  kind?: "purchase" | "reversal"; reverses_id?: string | null; reason?: string | null; recorded_by_name?: string | null;
  base_qty?: number | null; price_set_at?: string | null; before_state?: BeforeState;
};

/** The columns every purchase screen reads. */
export const PURCHASE_COLUMNS = "id,ingredient_id,qty,market_unit,total_kobo,payment_method,recorded_at,grade,season,raw_transcript,supplier_id,kind,reverses_id,reason,recorded_by_name,base_qty,price_set_at,before_state";

export function normalisePurchases(rows: unknown[] | null): PurchaseRow[] {
  return (rows ?? []).map((r) => {
    const x = r as PurchaseRow;
    return { ...x, qty: Number(x.qty), total_kobo: Number(x.total_kobo), base_qty: x.base_qty == null ? null : Number(x.base_qty) };
  });
}

export type PurchaseView = PurchaseRow & { isReversal: boolean; reversed: boolean; reversedByReason: string | null };

/** Newest first as given, each purchase marked with whether a reversal has undone it, and each reversal marked as one. */
export function describePurchases(rows: PurchaseRow[]): PurchaseView[] {
  const undoneBy = new Map<string, PurchaseRow>();
  for (const r of rows) if (r.kind === "reversal" && r.reverses_id) undoneBy.set(r.reverses_id, r);
  return rows.map((r) => ({ ...r, isReversal: r.kind === "reversal", reversed: undoneBy.has(r.id), reversedByReason: undoneBy.get(r.id)?.reason ?? null }));
}

/** Purchases that still count: no reversals and nothing that was reversed. Use this for any price hint or average. */
export const livePurchases = (rows: PurchaseRow[]): PurchaseRow[] => describePurchases(rows).filter((r) => !r.isReversal && !r.reversed);

export type IngredientNow = { price_updated_at: string | null; stock_base_qty: number; base_unit: string; name: string };

export const NEWER_PRICE_MESSAGE = "Cannot be reversed because a newer price or purchase exists for this ingredient.";
export const OLD_PURCHASE_MESSAGE = "Recorded before reversals existed, so it cannot be reversed.";

const sameInstant = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

/** null when this purchase can be reversed, else the sentence to show. Owners only. A purchase can be reversed only if nothing has
 *  changed the ingredient's price since (which also means it is the latest purchase of that ingredient). */
export function reverseBlocked(p: PurchaseView, ing: IngredientNow | undefined, role: string | null | undefined): string | null {
  if (!isOwnerRole(role)) return "Only an owner can reverse a purchase.";
  if (p.isReversal) return "This is a reversal. It cannot be reversed.";
  if (p.reversed) return "Already reversed.";
  if (!p.price_set_at || !p.before_state || p.base_qty == null) return OLD_PURCHASE_MESSAGE;
  if (!ing || !sameInstant(ing.price_updated_at, p.price_set_at)) return NEWER_PRICE_MESSAGE;
  return null;
}

export type ReversalPreview = {
  priceBackKobo: number | null; grade: string | null; season: string | null;
  stockAfter: number; belowZero: boolean;
  supplierBalanceAfterKobo: number | null; supplierOwesYouKobo: number;
};

/** What the screen tells the owner before the reversal is saved. supplierBalanceKobo is what you owe the supplier now (null when not a credit purchase). */
export function reversalPreview(p: PurchaseRow, ing: IngredientNow, supplierBalanceKobo: number | null): ReversalPreview {
  const stockAfter = Math.round((ing.stock_base_qty - Number(p.base_qty ?? 0)) * 10000) / 10000;
  const after = supplierBalanceKobo == null ? null : supplierBalanceKobo - Number(p.total_kobo);
  return {
    priceBackKobo: p.before_state?.cost_kobo ?? null, grade: p.before_state?.grade ?? null, season: p.before_state?.season ?? null,
    stockAfter, belowZero: stockAfter < 0,
    supplierBalanceAfterKobo: after, supplierOwesYouKobo: after != null && after < 0 ? -after : 0,
  };
}

export const REASON_MIN = 5;
export const reasonOk = (s: string) => s.trim().length >= REASON_MIN;
