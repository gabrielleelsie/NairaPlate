import { describe, expect, it } from "vitest";
import { balanceOf, reminderHtml, reminderSubject, sortByTime, type ReminderOrder } from "./catering-reminders.server";

const o = (over: Partial<ReminderOrder>): ReminderOrder => ({ event_time: "14:00", customer_name: "Mama Ada", phone: "0803 123 4567", items_summary: "100 plates jollof", total_contract_kobo: 5_000_000, deposit_kobo: 2_000_000, additional_payments_kobo: 0, settled: false, ...over });
const base = { kind: "evening" as const, businessName: "Mama T's Kitchen", eventDate: "2026-10-03", catering_url: "https://x/catering", unsubscribe_url: "https://x/u" };

describe("reminder email", () => {
  it("subject names the day and the count", () => {
    expect(reminderSubject("evening", "Mama T", "2026-10-03", 2)).toBe("Mama T: 2 orders tomorrow (Saturday 3 October 2026)");
    expect(reminderSubject("morning", "Mama T", "2026-10-02", 1)).toBe("Mama T: 1 order today (Friday 2 October 2026)");
  });
  it("shows the time, customer, items and what is still owed", () => {
    const h = reminderHtml({ ...base, orders: [o({})] });
    expect(h).toContain("TOMORROW&#39;S ORDERS".replace("&#39;", "'"));
    expect(h).toContain("2:00 pm: Mama Ada");
    expect(h).toContain("100 plates jollof");
    expect(h).toContain("₦30,000.00 still to collect");
  });
  it("says fully paid when nothing is owed or the order is settled", () => {
    expect(reminderHtml({ ...base, orders: [o({ deposit_kobo: 5_000_000 })] })).toContain("Fully paid");
    expect(reminderHtml({ ...base, orders: [o({ settled: true })] })).toContain("Fully paid");
  });
  it("morning email says today's orders", () => {
    expect(reminderHtml({ ...base, kind: "morning", orders: [o({})] })).toContain("TODAY'S ORDERS");
  });
  it("orders by time, with no time last", () => {
    expect(sortByTime([o({ customer_name: "C", event_time: null }), o({ customer_name: "B", event_time: "16:00" }), o({ customer_name: "A", event_time: "09:00" })]).map((x) => x.customer_name)).toEqual(["A", "B", "C"]);
  });
  it("escapes names and notes", () => {
    const h = reminderHtml({ ...base, orders: [o({ customer_name: "<b>x</b>", items_summary: "a & b" })] });
    expect(h).not.toContain("<b>x</b>");
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).toContain("a &amp; b");
  });
  it("balance never goes below zero", () => { expect(balanceOf(o({ deposit_kobo: 6_000_000 }))).toBe(0); });
});
