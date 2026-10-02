// Catering payment history: each deposit and payment is its own entry, and a mistake is corrected by a reversal entry, never an edit.
// Pure functions, so the screen and the tests share one answer. The database enforces the same rules; this is only for showing them.
import { isOwnerRole } from "@/lib/catering-order";
import { lagosDateKey } from "@/lib/lagos-time";

export type PaymentEntry = {
  id: string; order_id: string; kind: "deposit" | "payment" | "reversal"; amount_kobo: number; method: string | null;
  reverses_id: string | null; reason: string | null; carried_over: boolean; recorded_by_name: string | null; created_at: string;
};

export type EntryView = PaymentEntry & { label: string; reversed: boolean; reversedByReason: string | null };

export const REVERSAL_REASON_MIN = 5;
export const reasonOk = (s: string) => s.trim().length >= REVERSAL_REASON_MIN;

const KIND_LABEL = { deposit: "Deposit", payment: "Payment", reversal: "Reversal" } as const;

/** Entries oldest first, each marked with whether a later reversal has undone it. */
export function describeEntries(entries: PaymentEntry[]): EntryView[] {
  const sorted = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.kind.localeCompare(b.kind));
  const undoneBy = new Map<string, PaymentEntry>();
  for (const e of sorted) if (e.kind === "reversal" && e.reverses_id) undoneBy.set(e.reverses_id, e);
  return sorted.map((e) => ({ ...e, label: KIND_LABEL[e.kind], reversed: undoneBy.has(e.id), reversedByReason: undoneBy.get(e.id)?.reason ?? null }));
}

/** What the customer has actually paid after reversals: the sum of every entry. */
export const netReceived = (entries: PaymentEntry[]) => entries.reduce((s, e) => s + e.amount_kobo, 0);

/** Only an owner can reverse, only a deposit or payment, and only once. */
export function canReverse(e: EntryView, role: string | null | undefined): boolean {
  return isOwnerRole(role) && e.kind !== "reversal" && !e.reversed;
}

export const methodLabel = (m: string | null) => (m === "cash" ? "cash" : m === "transfer" ? "transfer" : "");

/** "12 Oct, 2:30 pm" in Nigeria time. */
export function entryWhen(iso: string): string {
  const d = new Date(iso);
  const date = new Date(`${lagosDateKey(d)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" }).toLowerCase();
  return `${date}, ${time}`;
}
