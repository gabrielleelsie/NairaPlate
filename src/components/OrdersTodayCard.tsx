import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import { lagosDateKey } from "@/lib/lagos-time";
import { daysFromToday, longDate, timeLabel } from "@/lib/catering";

type Order = { id: string; customer_name: string; event_date: string; event_time: string | null; items_summary: string | null; balance: number; settled: boolean };

/** Catering orders due today and tomorrow, on the home screen for owners and cashiers. Shows nothing when there are none. */
export function OrdersTodayCard() {
  const { session } = useStaffSession();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const now = new Date();
    const today = lagosDateKey(now), tomorrow = lagosDateKey(new Date(now.getTime() + 86_400_000));
    supabase.from("catering_deposits").select("id,customer_name,event_date,event_time,items_summary,total_contract_kobo,deposit_kobo,additional_payments_kobo,settled")
      .in("event_date", [today, tomorrow]).order("event_date").order("event_time", { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        if (cancelled) return;
        setOrders((data ?? []).map((r) => ({
          id: String(r.id), customer_name: String(r.customer_name), event_date: String(r.event_date), event_time: (r.event_time as string | null) ?? null,
          items_summary: (r.items_summary as string | null) ?? null, settled: !!r.settled,
          balance: Math.max(0, Number(r.total_contract_kobo ?? 0) - Number(r.deposit_kobo ?? 0) - Number(r.additional_payments_kobo ?? 0)),
        })));
      });
    return () => { cancelled = true; };
  }, [session]);

  if (!orders || orders.length === 0) return null;
  const dueToday = orders.filter((o) => daysFromToday(o.event_date) === 0);
  const dueTomorrow = orders.filter((o) => daysFromToday(o.event_date) === 1);
  const block = (title: string, list: Order[], date: string) => list.length === 0 ? null : (
    <div className="mt-3" data-testid={`orders-${title.toLowerCase()}`}>
      <div className="text-sm font-semibold text-foreground">{title}: {longDate(date)}</div>
      <ul className="mt-1 space-y-1">
        {list.map((o) => (
          <li key={o.id} className="text-sm text-foreground">
            <span className="font-medium">{timeLabel(o.event_time) || "Time not set"}</span> {o.customer_name}
            {o.items_summary ? <span className="text-muted-foreground">, {o.items_summary}</span> : null}
            <span className={o.balance > 0 && !o.settled ? " font-semibold text-destructive" : " text-muted-foreground"}> · {o.balance > 0 && !o.settled ? `${formatNaira(o.balance)} to collect` : "paid in full"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section aria-label="Orders today and tomorrow" className="rounded-xl border border-primary bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase text-brand-navy/70">Orders today and tomorrow</h2>
        {dueToday.length > 0 && <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">{dueToday.length} today</span>}
      </div>
      {block("Today", dueToday, lagosDateKey(new Date()))}
      {block("Tomorrow", dueTomorrow, lagosDateKey(new Date(Date.now() + 86_400_000)))}
      <Link to="/catering" className="mt-3 inline-block text-sm font-medium underline">Open catering orders</Link>
    </section>
  );
}
