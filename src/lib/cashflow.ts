// The ONE place the 7-day cashflow forecast is worked out.
import type { SupabaseClient } from "@supabase/supabase-js";
import { expectedDrawerCash } from "@/lib/cash-drawer";
import { normaliseTxns, supplierBalance } from "@/lib/suppliers";

export type CashflowForecast = {
  window: { from: string; to: string }; // Lagos calendar dates, inclusive
  cash_on_hand_kobo: number;
  open_drawers: { id: string; opened_at: string; opening_float_kobo: number; cash_sales_kobo: number; expected_cash_kobo: number }[];
  owed_to_us_kobo: number;
  customer_credit_kobo: number;
  customer_credit_count: number;
  catering_due_kobo: number;
  catering_due: { id: string; customer_name: string; event_date: string; remaining_kobo: number }[];
  owed_out_kobo: number;
  suppliers_owed: { id: string; name: string; balance_kobo: number }[];
  projected_kobo: number;
};

/** Today's date in Lagos as YYYY-MM-DD, plus `days`. */
export function lagosDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function calculateCashflowForecast(supabase: SupabaseClient, business_id: string): Promise<CashflowForecast> {
  const from = lagosDate(0);
  const to = lagosDate(6); // today + next 6 days = 7 days
  const nowIso = new Date().toISOString();

  const [drawers, credits, catering, suppliers, txns] = await Promise.all([
    supabase.from("cash_drawers").select("id,business_id,opening_float_kobo,opened_at").eq("business_id", business_id).eq("status", "open"),
    supabase.from("customer_credits").select("amount_kobo").eq("business_id", business_id).eq("settled", false),
    supabase.from("catering_deposits").select("id,customer_name,event_date,deposit_kobo,additional_payments_kobo,total_contract_kobo")
      .eq("business_id", business_id).eq("settled", false).gte("event_date", from).lte("event_date", to),
    supabase.from("suppliers").select("id,name").eq("business_id", business_id),
    supabase.from("supplier_transactions").select("*").eq("business_id", business_id),
  ]);
  const failed = [drawers, credits, catering, suppliers, txns].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  // (1) Cash on hand — same expected-cash calculation as closing a shift.
  const open_drawers = await Promise.all((drawers.data ?? []).map(async (d) => {
    const r = await expectedDrawerCash(supabase, d, nowIso);
    return { id: d.id, opened_at: d.opened_at, opening_float_kobo: Number(d.opening_float_kobo), ...r };
  }));
  const cash_on_hand_kobo = open_drawers.reduce((s, d) => s + d.expected_cash_kobo, 0);

  // (2) Owed to us — unsettled customer credit + catering balances with events in the window.
  const customer_credit_kobo = (credits.data ?? []).reduce((s, c) => s + Number(c.amount_kobo), 0);
  const catering_due = (catering.data ?? []).map((b) => ({
    id: b.id, customer_name: b.customer_name, event_date: b.event_date,
    remaining_kobo: Number(b.total_contract_kobo) - Number(b.deposit_kobo) - Number(b.additional_payments_kobo ?? 0),
  })).filter((b) => b.remaining_kobo > 0);
  const catering_due_kobo = catering_due.reduce((s, b) => s + b.remaining_kobo, 0);
  const owed_to_us_kobo = customer_credit_kobo + catering_due_kobo;

  // (3) Owed out — each supplier's balance (same function as the Suppliers screen); overpaid ones don't offset.
  const all = normaliseTxns(txns.data);
  const suppliers_owed = (suppliers.data ?? [])
    .map((s) => ({ id: s.id, name: s.name, balance_kobo: supplierBalance(all, s.id) }))
    .filter((s) => s.balance_kobo > 0);
  const owed_out_kobo = suppliers_owed.reduce((s, x) => s + x.balance_kobo, 0);

  return {
    window: { from, to }, cash_on_hand_kobo, open_drawers,
    owed_to_us_kobo, customer_credit_kobo, customer_credit_count: (credits.data ?? []).length,
    catering_due_kobo, catering_due, owed_out_kobo, suppliers_owed,
    projected_kobo: cash_on_hand_kobo + owed_to_us_kobo - owed_out_kobo,
  };
}
