// Attention inbox: a READ-ONLY view over signals NairaPlate already records.
// It never stores its own state and never marks anything "resolved": each item clears only when the
// source screen handles it (approve/reject, close the shift, fix the price). Flags keep their own "Mark as seen".
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "@/lib/costing";
import { pendingRequests, normalisePayouts, PAYOUT_COLUMNS, categoryLabel } from "@/lib/cash-payouts";
import { loadCostCheck, type AttentionDish, type StaleIngredient } from "@/lib/cost-check";
import { KEYS_ALERT_TYPE } from "@/lib/payments";

export type InboxCategory = "approval" | "cash" | "stock" | "system";
export type InboxItem = {
  key: string; category: InboxCategory; severity: "high" | "medium" | "low";
  title: string; detail: string; at: string | null; link: string; linkLabel: string;
  flagId?: string; // present only for margin_flags rows, which can be marked as seen
};
export type InboxSummary = Record<InboxCategory, number>;

export const OPEN_SHIFT_HOURS = 18;
export const CATEGORY_LABEL: Record<InboxCategory, string> = {
  approval: "Needs approval", cash: "Cash & till", stock: "Stock & pricing", system: "System",
};

type LateRow = { id: string; paper_reference: string; status: string; actual_sold_at: string; cash_kobo: number | string; transfer_kobo: number | string };
type DrawerRow = { id: string; opened_at: string };
type FlagRow = { id: string; flag_type: string; severity: string | null; message: string | null; created_at: string };
type PayoutLike = { id: string; kind: string; amount_kobo: number; category: string; note: string; recorded_by_name: string | null; created_at: string; approves_id: string | null; reverses_id: string | null };

export function buildInbox(input: {
  now: Date; lateEntries: LateRow[]; payouts: PayoutLike[]; openDrawers: DrawerRow[]; flags: FlagRow[];
  attention: AttentionDish[]; stale: StaleIngredient[];
}): InboxItem[] {
  const out: InboxItem[] = [];
  for (const e of input.lateEntries) {
    if (e.status !== "submitted" && e.status !== "needs_shift_review") continue;
    const total = Number(e.cash_kobo) + Number(e.transfer_kobo);
    out.push({ key: `late:${e.id}`, category: "approval", severity: e.status === "needs_shift_review" ? "high" : "medium",
      title: `Paper sale ${e.paper_reference} waiting for approval`,
      detail: `${formatNaira(total)}${e.status === "needs_shift_review" ? " · its shift is closed, choose how to record it" : ""}`,
      at: e.actual_sold_at, link: "/late-entries", linkLabel: "Review paper sale" });
  }
  for (const p of pendingRequests(input.payouts as never)) {
    out.push({ key: `payout:${p.id}`, category: "approval", severity: "medium",
      title: `${formatNaira(p.amount_kobo)} cash request waiting`,
      detail: `${categoryLabel(p.category)}${p.recorded_by_name ? ` · asked by ${p.recorded_by_name}` : ""} · "${p.note}"`,
      at: p.created_at, link: "/drawer", linkLabel: "Open cash drawer" });
  }
  const cutoff = input.now.getTime() - OPEN_SHIFT_HOURS * 3600_000;
  for (const d of input.openDrawers) {
    if (Date.parse(d.opened_at) > cutoff) continue;
    const hours = Math.floor((input.now.getTime() - Date.parse(d.opened_at)) / 3600_000);
    out.push({ key: `drawer:${d.id}`, category: "cash", severity: "high", title: `Shift open for ${hours} hours`,
      detail: "Count the cash and close it, or force-close it.", at: d.opened_at, link: "/drawer", linkLabel: "Close the shift" });
  }
  for (const f of input.flags) {
    const sev = f.severity === "critical" ? "high" : f.severity === "warn" ? "medium" : "low";
    const base = { key: `flag:${f.id}`, severity: sev as InboxItem["severity"], detail: f.message ?? "", at: f.created_at, flagId: f.id };
    if (f.flag_type === "drawer_variance") out.push({ ...base, category: "cash", title: "Cash drawer did not balance", link: "/drawer", linkLabel: "Open cash drawer" });
    else if (f.flag_type === "negative_stock" || f.flag_type === "low_stock")
      out.push({ ...base, category: "stock", title: f.flag_type === "negative_stock" ? "Stock below zero" : "Stock running low", link: "/ingredients", linkLabel: "Open ingredients" });
    else if (f.flag_type === KEYS_ALERT_TYPE) out.push({ ...base, category: "system", title: "Payment connection needs attention", link: "/payments", linkLabel: "Open payments" });
    else out.push({ ...base, category: "system", title: f.flag_type.replace(/_/g, " "), link: "/flags", linkLabel: "Open alerts" });
  }
  for (const a of input.attention) {
    out.push({ key: `margin:${a.recipe_id}`, category: "stock", severity: "medium",
      title: `${a.name} margin ${a.margin_pct.toFixed(0)}% (target ${a.target_pct.toFixed(0)}%)`,
      detail: `Sells at ${formatNaira(a.price_kobo)}, costs ${formatNaira(a.cost_per_plate_kobo)} a plate`,
      at: null, link: "/cost-check", linkLabel: "Open cost check" });
  }
  for (const s of input.stale) {
    out.push({ key: `stale:${s.id}`, category: "stock", severity: "low", title: `${s.name} price may be out of date`,
      detail: s.days_old == null ? "Price never updated" : `Last updated ${s.days_old} days ago`, at: null, link: "/ingredients", linkLabel: "Update price" });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.at ?? "").localeCompare(a.at ?? ""));
}

export function summarise(items: InboxItem[]): InboxSummary {
  const s: InboxSummary = { approval: 0, cash: 0, stock: 0, system: 0 };
  for (const i of items) s[i.category]++;
  return s;
}

/** Fetches every source in parallel, scoped to one business. Partial failures become warnings, not a blank screen. */
export async function loadInboxItems(supabase: SupabaseClient, businessId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const [late, pay, drawers, flags, cost] = await Promise.all([
    supabase.from("late_entries").select("id,paper_reference,status,actual_sold_at,cash_kobo,transfer_kobo")
      .eq("business_id", businessId).in("status", ["submitted", "needs_shift_review"]),
    supabase.from("cash_drawer_payouts").select(PAYOUT_COLUMNS).eq("business_id", businessId).gte("created_at", since),
    supabase.from("cash_drawers").select("id,opened_at").eq("business_id", businessId).eq("status", "open"),
    supabase.from("margin_flags").select("id,flag_type,severity,message,created_at").eq("business_id", businessId).eq("acknowledged", false),
    loadCostCheck(supabase, businessId, now).then((c) => ({ c, err: null as string | null }), (e: Error) => ({ c: null, err: e.message })),
  ]);
  const warnings = [
    late.error && "paper sales", pay.error && "cash requests", drawers.error && "open shifts", flags.error && "alerts", cost.err && "cost check",
  ].filter(Boolean) as string[];
  const items = buildInbox({
    now, lateEntries: (late.data ?? []) as LateRow[], payouts: normalisePayouts(pay.data ?? null) as PayoutLike[],
    openDrawers: (drawers.data ?? []) as DrawerRow[], flags: (flags.data ?? []) as FlagRow[],
    attention: cost.c?.attention ?? [], stale: cost.c?.stale ?? [],
  });
  return { items, warnings };
}
