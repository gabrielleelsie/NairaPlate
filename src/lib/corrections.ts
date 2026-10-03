// Owner corrections for channel payouts, price decisions and batches: the ONE place reversed pairs are worked out.
// These records are never edited or deleted. A mistake is undone by a reversal entry (owner only, with a reason of 5+ characters).
// A reversal row carries negated figures, so a reversed entry and its reversal cancel out. Screens hide the pair from totals and show
// the original marked "Reversed" with the reason. The database enforces the same rules; this is only for showing them.
import { isOwnerRole } from "@/lib/catering-order";

export const REASON_MIN = 5;
export const reasonOk = (s: string) => s.trim().length >= REASON_MIN;
export const canCorrect = (role: string | null | undefined) => isOwnerRole(role);

export type Correctable = { id: string; kind: "entry" | "reversal" | null; reverses_id: string | null; reason: string | null; recorded_by_name: string | null; created_at: string };
export type WithReversal<T> = T & { reversed: boolean; reversalReason: string | null; reversedBy: string | null; reversedAt: string | null };

/** Columns every screen reads on top of its own. */
export const CORRECTION_COLUMNS = "kind,reverses_id,reason,recorded_by_name";

/** Entries (newest first as given) with their reversal attached. The reversal rows themselves are not listed on their own. */
export function pairReversals<T extends Correctable>(rows: T[]): WithReversal<T>[] {
  const reversalOf = new Map<string, T>();
  for (const r of rows) if (r.kind === "reversal" && r.reverses_id) reversalOf.set(r.reverses_id, r);
  return rows.filter((r) => r.kind !== "reversal").map((r) => {
    const rev = reversalOf.get(r.id);
    return { ...r, reversed: !!rev, reversalReason: rev?.reason ?? null, reversedBy: rev?.recorded_by_name ?? null, reversedAt: rev?.created_at ?? null };
  });
}

/** Entries that still count: not reversed. Use this for any total or list of "what happened". */
export const standingEntries = <T extends Correctable>(rows: T[]): T[] => pairReversals(rows).filter((r) => !r.reversed);

/** Sum a figure over a list that may contain reversal rows: the negated rows cancel the entries they reverse. */
export const netTotal = <T extends Correctable>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

/** Whether the Reverse button should be offered: owners only, and only for an entry that has not been reversed. */
export const canReverse = (role: string | null | undefined, row: { kind?: string | null; reversed: boolean }) =>
  canCorrect(role) && row.kind !== "reversal" && !row.reversed;

/** What the owner is told before confirming a price decision reversal. */
export function priceReversalNote(d: { decision: string | null; previous_price_kobo: number | null }, fmt: (kobo: number) => string): string {
  if (d.decision === "publish" && d.previous_price_kobo !== null) return `The dish price goes back to ${fmt(d.previous_price_kobo)}. This only works if the price has not changed since.`;
  return "This decision did not change a price, so only the record is reversed.";
}

export const PRICE_DECISION_LABEL: Record<string, string> = {
  publish: "Published new price", adjust_portion: "Chose to adjust portion", defer: "Deferred", reversal: "Reversed",
};

/** Plain reasons shown when the database refuses, so the owner sees what to do. */
export function friendlyReversalError(message: string): string {
  if (/already been reversed/i.test(message)) return "This has already been reversed.";
  if (/price has changed since|newer published price/i.test(message)) return "Not reversed: the dish price has changed since this decision, so it cannot be put back safely.";
  if (/before reversals existed/i.test(message)) return "This batch was recorded before reversals existed, so it cannot be reversed.";
  return message;
}
