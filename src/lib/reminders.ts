// Expiry reminder emails: which businesses are due one today, and what the email says.
// Pure functions shared by the hourly job, the admin screen (who is due, test email) and the tests.
// Dates are Nigeria calendar days. Access ends at 23:59:59 WAT on the last day of the period, so "ends in 1 day"
// means the end date is tomorrow. A reminder is sent on an exact day only; a missed day is not made up later.
import { z } from "zod";
import { DAY_MS, lagosDateKey } from "@/lib/lagos-time";
import { PLAN_LABEL, formatLagosDate } from "@/lib/subscription";
import { plain } from "@/lib/platform-settings";

export const WHATSAPP_NUMBER = "2349124766666";
export type ReminderKind = "paid_before" | "paid_after" | "trial_before" | "trial_after";
export const REMINDER_KINDS: ReminderKind[] = ["paid_before", "paid_after", "trial_before", "trial_after"];
export const KIND_LABEL: Record<ReminderKind, string> = {
  paid_before: "Paid plan, before it ends", paid_after: "Paid plan, after it ended",
  trial_before: "Free trial, before it ends", trial_after: "Free trial, after it ended",
};
export const REMINDER_LABEL = "Reminder emails";

// {when} is "today", "tomorrow", "in 3 days", "yesterday" or "3 days ago". {days} is the number of days.
export const REMINDER_PLACEHOLDERS = ["business", "plan", "date", "days", "when"] as const;

export type Template = { subject: string; body: string };
export type ReminderSettings = {
  enabled: boolean; send_hour: number;
  paid_days_before: number[]; paid_days_after: number[]; trial_days_before: number[]; trial_days_after: number[];
  templates: Record<ReminderKind, Template>;
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false, // off until an admin switches it on, after a test email has arrived
  send_hour: 9,
  paid_days_before: [7, 3, 1], paid_days_after: [1], trial_days_before: [2, 1], trial_days_after: [1],
  templates: {
    paid_before: {
      subject: "Your NairaPlate plan ends {when}",
      body: "Hello,\n\nThe {plan} plan for {business} ends on {date} at 11:59 pm. After that, nobody at {business} can sign in until the plan is renewed. Your records stay safe.\n\nTo renew, message us on WhatsApp and tell us the plan you want.",
    },
    paid_after: {
      subject: "Your NairaPlate plan has ended",
      body: "Hello,\n\nThe plan for {business} ended on {date} ({when}), so the account is locked. Nothing has been deleted.\n\nMessage us on WhatsApp to renew, and we will switch it back on once your payment is confirmed.",
    },
    trial_before: {
      subject: "Your NairaPlate free trial ends {when}",
      body: "Hello,\n\nYour 7-day NairaPlate trial for {business} ends on {date} at 11:59 pm. Your business has already been assigned the NairaPlate profile that fits it.\n\nTo continue, message us on WhatsApp and tell us the billing period you want: monthly, every 3 months or every 12 months.\n\nWe will confirm your first payment amount, including the one-off setup fee. Once payment is recorded, we will set up your full menu with you.",
    },
    trial_after: {
      subject: "Your NairaPlate free trial has ended",
      body: "Hello,\n\nYour NairaPlate trial for {business} ended on {date} and access is paused. Your records are safe.\n\nTo continue, message us on WhatsApp and tell us whether you want to pay monthly, every 3 months or every 12 months.\n\nWe will confirm your billing period and first payment amount, including the one-off setup fee. Once payment is recorded, we will switch your account back on and set up your full menu with you.",
    },
  },
};

const days = (min: number, label: string) =>
  z.array(z.number().int(`${label}: whole days only.`).min(min, `${label}: each number must be ${min} or more.`).max(60, `${label}: each number must be 60 or less.`))
    .max(6, `${label}: use six days at most.`)
    .refine((a) => new Set(a).size === a.length, `${label}: each day only once.`);
const template = (label: string) => z.object({
  subject: plain(120, REMINDER_PLACEHOLDERS, `${label} subject`),
  body: plain(900, REMINDER_PLACEHOLDERS, `${label} message`),
}).strict();

export const REMINDER_SCHEMA = z.object({
  enabled: z.boolean(),
  send_hour: z.number().int("Hour: whole number.").min(0, "Hour must be 0 to 23.").max(23, "Hour must be 0 to 23."),
  paid_days_before: days(0, "Paid, days before"), paid_days_after: days(1, "Paid, days after"),
  trial_days_before: days(0, "Trial, days before"), trial_days_after: days(1, "Trial, days after"),
  templates: z.object({
    paid_before: template(KIND_LABEL.paid_before), paid_after: template(KIND_LABEL.paid_after),
    trial_before: template(KIND_LABEL.trial_before), trial_after: template(KIND_LABEL.trial_after),
  }).strict(),
}).strict();

/** Whatever is stored, completed with the defaults. A stored value that no longer validates falls back to the defaults (switched off). */
export function mergeReminders(raw: unknown): ReminderSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_REMINDERS;
  const r = raw as Partial<ReminderSettings>;
  const merged = { ...DEFAULT_REMINDERS, ...r, templates: { ...DEFAULT_REMINDERS.templates, ...(r.templates ?? {}) } };
  const ok = REMINDER_SCHEMA.safeParse(merged);
  return ok.success ? ok.data : DEFAULT_REMINDERS;
}

/** "7, 3, 1" to [7, 3, 1]. Returns undefined when something is not a whole number. */
export function parseDays(text: string): number[] | undefined {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  return nums.some(Number.isNaN) ? undefined : nums.sort((a, b) => b - a);
}

export type Due = { kind: ReminderKind; offset: number; ends_at: string; end_date_key: string };

/** Is this business due a reminder today (Nigeria time)? At most one kind matches. */
export function dueReminder(
  b: { status: string; plan: string | null; access_ends_at: string | null },
  now: Date, s: ReminderSettings,
): Due | null {
  if (b.status !== "approved" || !b.access_ends_at) return null;
  const ends = new Date(b.access_ends_at);
  if (Number.isNaN(ends.getTime())) return null;
  const trial = b.plan === "trial";
  if (!trial && !(b.plan === "monthly" || b.plan === "quarterly" || b.plan === "yearly")) return null;
  const endKey = lagosDateKey(ends);
  const diff = Math.round((Date.parse(endKey) - Date.parse(lagosDateKey(now))) / DAY_MS); // days until the end date; negative = past
  const expired = ends.getTime() <= now.getTime();
  if (!expired) {
    const list = trial ? s.trial_days_before : s.paid_days_before;
    if (diff >= 0 && list.includes(diff)) return { kind: trial ? "trial_before" : "paid_before", offset: diff, ends_at: b.access_ends_at, end_date_key: endKey };
    return null;
  }
  const ago = -diff;
  const list = trial ? s.trial_days_after : s.paid_days_after;
  return ago >= 1 && list.includes(ago) ? { kind: trial ? "trial_after" : "paid_after", offset: ago, ends_at: b.access_ends_at, end_date_key: endKey } : null;
}

export function whenPhrase(kind: ReminderKind, offset: number): string {
  if (kind.endsWith("_before")) return offset === 0 ? "today" : offset === 1 ? "tomorrow" : `in ${offset} days`;
  return offset === 1 ? "yesterday" : `${offset} days ago`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (w, n: string) => (n in v ? v[n]! : w));

/** The email for one business. Admin text and business names are escaped, so nothing typed can become markup. */
export function renderReminder(s: ReminderSettings, kind: ReminderKind, b: { name: string; plan: string | null }, due: { offset: number; ends_at: string }, opts?: { test?: boolean }) {
  const vars = {
    business: b.name, plan: PLAN_LABEL[b.plan ?? ""] ?? "NairaPlate", date: formatLagosDate(due.ends_at),
    days: String(due.offset), when: whenPhrase(kind, due.offset),
  };
  const t = s.templates[kind];
  const subject = (opts?.test ? "[Test] " : "") + fill(t.subject, vars);
  const paragraphs = fill(t.body, vars).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hello NairaPlate, I would like to renew ${b.name}.`)}`;
  const html = `<div style="font-family:Figtree,system-ui,-apple-system,'Segoe UI',sans-serif;background:#EAF4FF;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden">
    <div style="background:#0B1F33;color:#FFFFFF;padding:18px 24px;font-size:18px;font-weight:800">NairaPlate</div>
    <div style="padding:24px">
      ${opts?.test ? `<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#B42318">THIS IS A TEST. It was sent only to you.</p>` : ""}
      ${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0B1F33">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}
      <p style="margin:20px 0 0"><a href="${esc(wa)}" style="display:inline-block;background:#1677D2;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:10px">Message us on WhatsApp</a></p>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6B7280">You get this email because you are an owner of ${esc(b.name)} on NairaPlate. It is about your subscription, not a marketing message.</p>
    </div>
  </div>
</div>`;
  return { subject, html };
}
