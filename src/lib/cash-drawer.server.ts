// Server-only: closes a cash drawer. Used by the cashier's own close and by an owner closing a shift someone left open.
// Expected cash always comes from the one calculation in cash-drawer.ts. The closed record keeps the breakdown it was worked out from.
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit.server";
import { expectedDrawerCash } from "@/lib/cash-drawer";

const naira = (k: number) =>
  `₦${(Math.abs(k) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type OpenDrawer = { id: string; business_id: string; opening_float_kobo: number | string; opened_at: string; opened_by_name?: string | null };
type Actor = { id: string; role: string; name: string };

export class DrawerCloseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function closeDrawerRecord(
  admin: SupabaseClient, drawer: OpenDrawer, o: { countedKobo: number | null; actor: Actor; forced: boolean; reason?: string },
) {
  const closedAt = new Date().toISOString();
  let r;
  try { r = await expectedDrawerCash(admin, drawer, closedAt); } catch { throw new DrawerCloseError("Could not read orders.", 500); }
  const discrepancy = o.countedKobo == null ? null : o.countedKobo - r.expected_cash_kobo;

  const { data: done, error } = await admin.from("cash_drawers").update({
    closing_counted_kobo: o.countedKobo, expected_cash_kobo: r.expected_cash_kobo, discrepancy_kobo: discrepancy,
    cash_sales_kobo: r.cash_sales_kobo, catering_cash_kobo: r.catering_cash_kobo, debt_cash_kobo: r.debt_cash_kobo, payouts_kobo: r.payouts_kobo,
    closed_by: o.actor.id, closed_by_name: o.actor.name, forced: o.forced, close_reason: o.forced ? (o.reason ?? "").trim() : null,
    status: "closed", closed_at: closedAt,
  }).eq("id", drawer.id).eq("status", "open").select("id");
  // The database refuses to close a shift while a cash payout request is waiting for the owner. Say so plainly.
  if (error) throw new DrawerCloseError(/waiting for the owner/i.test(error.message) ? "A cash payout is waiting for the owner. Ask them to approve or decline it, then close the shift." : "Could not close the shift.", /waiting for the owner/i.test(error.message) ? 409 : 500);
  if (!done || done.length === 0) throw new DrawerCloseError("This shift is already closed.", 409);

  const who = o.forced ? (drawer.opened_by_name ?? "a cashier") : o.actor.name;
  let flag = null;
  if (discrepancy != null && discrepancy !== 0) {
    const kind = discrepancy < 0 ? "short" : "over";
    const { data: f } = await admin.from("margin_flags").insert({
      business_id: drawer.business_id, flag_type: "drawer_variance",
      severity: Math.abs(discrepancy) < 100000 ? "warn" : "critical",
      message: `Cash drawer was ${kind} by ${naira(discrepancy)} on ${who}'s shift.`,
      role: "owner", acknowledged: false,
    }).select("*").single();
    flag = f;
    await writeAudit(admin, { business_id: drawer.business_id, actor_id: o.actor.id, actor_role: o.actor.role, action: "drawer_discrepancy",
      entity_type: "cash_drawers", entity_id: drawer.id,
      details: `${who}: ${kind} by ${naira(discrepancy)} (expected ${naira(r.expected_cash_kobo)}, counted ${naira(o.countedKobo ?? 0)})` });
  }
  if (o.forced) {
    await writeAudit(admin, { business_id: drawer.business_id, actor_id: o.actor.id, actor_role: o.actor.role, action: "drawer_force_closed",
      entity_type: "cash_drawers", entity_id: drawer.id,
      details: `${o.actor.name} closed ${who}'s open shift: ${(o.reason ?? "").trim()} (expected ${naira(r.expected_cash_kobo)}${o.countedKobo == null ? ", not counted" : `, counted ${naira(o.countedKobo)}`})` });
  }
  return {
    opening_float_kobo: Number(drawer.opening_float_kobo), cash_sales_kobo: r.cash_sales_kobo, catering_cash_kobo: r.catering_cash_kobo, debt_cash_kobo: r.debt_cash_kobo, payouts_kobo: r.payouts_kobo,
    expected_cash_kobo: r.expected_cash_kobo, closing_counted_kobo: o.countedKobo, discrepancy_kobo: discrepancy, flag,
  };
}
