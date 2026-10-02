// Server-only pieces of the catering reminder emails: the subject and the body. Morning = orders today, evening = orders tomorrow.
import { formatNaira } from "@/lib/costing";
import { longDate, timeLabel } from "@/lib/catering";

export type ReminderKind = "morning" | "evening";
export type ReminderOrder = {
  event_time: string | null; customer_name: string; phone: string | null; items_summary: string | null;
  total_contract_kobo: number; deposit_kobo: number; additional_payments_kobo: number; settled: boolean;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const balanceOf = (o: ReminderOrder) => Math.max(0, o.total_contract_kobo - o.deposit_kobo - (o.additional_payments_kobo ?? 0));

/** Orders with no time go last. */
export function sortByTime(orders: ReminderOrder[]): ReminderOrder[] {
  return [...orders].sort((a, b) => (a.event_time ?? "99:99").localeCompare(b.event_time ?? "99:99"));
}

export function reminderSubject(kind: ReminderKind, businessName: string, eventDate: string, count: number): string {
  const when = kind === "morning" ? "today" : "tomorrow";
  return `${businessName}: ${count} order${count === 1 ? "" : "s"} ${when} (${longDate(eventDate)})`;
}

export function reminderHtml(o: { kind: ReminderKind; businessName: string; eventDate: string; orders: ReminderOrder[]; catering_url: string; unsubscribe_url: string }): string {
  const when = o.kind === "morning" ? "TODAY'S ORDERS" : "TOMORROW'S ORDERS";
  const rows = sortByTime(o.orders).map((x) => {
    const bal = balanceOf(x);
    const owing = bal > 0 && !x.settled;
    return `<div style="padding:12px 0;border-bottom:1px solid #D3E4F7">
      <div style="font-size:16px;font-weight:700;color:#0B1F33">${esc(timeLabel(x.event_time) || "Time not set")}: ${esc(x.customer_name)}</div>
      ${x.items_summary ? `<div style="margin-top:3px;font-size:14px;color:#4A5563">${esc(x.items_summary)}</div>` : ""}
      ${x.phone ? `<div style="margin-top:3px;font-size:13px;color:#6B7280">Phone: ${esc(x.phone)}</div>` : ""}
      <div style="margin-top:4px;font-size:14px;font-weight:700;color:${owing ? "#B42318" : "#067647"}">${owing ? `${esc(formatNaira(bal))} still to collect` : "Fully paid"}</div>
    </div>`;
  }).join("");
  return `<div style="font-family:Figtree,system-ui,-apple-system,'Segoe UI',sans-serif;background:#EAF4FF;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden">
    <div style="background:#0B1F33;color:#FFFFFF;padding:18px 24px;font-size:18px;font-weight:800">NairaPlate</div>
    <div style="padding:24px">
      <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#1677D2">${when}</div>
      <h1 style="margin:6px 0 4px;font-size:21px;color:#0B1F33">${esc(o.businessName)}</h1>
      <p style="margin:0 0 8px;font-size:14px;color:#4A5563">${esc(longDate(o.eventDate))}</p>
      ${rows}
      <p style="margin:24px 0 0"><a href="${esc(o.catering_url)}" style="display:inline-block;background:#1677D2;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px">Open catering orders</a></p>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6B7280">
        You get this email because you are an owner of ${esc(o.businessName)} on NairaPlate and have orders on this date.
        <a href="${esc(o.unsubscribe_url)}" style="color:#1677D2">Stop these emails</a>. This also stops your daily summary email.
      </p>
    </div>
  </div>
</div>`;
}
