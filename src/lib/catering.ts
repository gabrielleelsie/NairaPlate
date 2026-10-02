// Catering orders: dates the owner cannot mix up, and what to say to the customer. Pure functions, so they can be tested.
// Every date is a calendar date in Nigeria time (WAT, UTC+1, no daylight saving).
import { lagosDateKey } from "@/lib/lagos-time";
import { formatNaira } from "@/lib/costing";

export type Bucket = "past" | "today" | "tomorrow" | "week" | "later";

const DAY = 86_400_000;
const parts = (key: string) => key.split("-").map(Number) as [number, number, number];
const utcMs = (key: string) => { const [y, m, d] = parts(key); return Date.UTC(y, m - 1, d); };

/** Whole days from today (Nigeria time) to the event date. 0 = today, 1 = tomorrow, negative = past. */
export function daysFromToday(eventDate: string, now: Date = new Date()): number {
  return Math.round((utcMs(eventDate) - utcMs(lagosDateKey(now))) / DAY);
}

/** "Saturday 4 October 2026". The weekday is what owners check a date against. */
export function longDate(eventDate: string): string {
  return new Date(utcMs(eventDate)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(",", "");
}

export function distanceLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** "Saturday 4 October 2026 (in 2 days)". */
export function eventDateLabel(eventDate: string, now: Date = new Date()): string {
  return `${longDate(eventDate)} (${distanceLabel(daysFromToday(eventDate, now))})`;
}

/** "14:00" or "14:00:00" -> "2:00 pm". Empty when there is no time. */
export function timeLabel(time: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return "";
  const h = Number(m[1]), min = m[2];
  if (h > 23) return "";
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? "am" : "pm"}`;
}

/** What the screen reads back before saving: "Saturday 4 October 2026 at 2:00 pm". */
export function readBack(eventDate: string, time: string | null | undefined): string {
  const t = timeLabel(time);
  return t ? `${longDate(eventDate)} at ${t}` : longDate(eventDate);
}

export function bucketOf(days: number): Bucket {
  if (days < 0) return "past";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days <= 7 ? "week" : "later";
}

export const BUCKET_LABEL: Record<Bucket, string> = { past: "Past", today: "Today", tomorrow: "Tomorrow", week: "This week", later: "Later" };
export const BUCKET_ORDER: Bucket[] = ["today", "tomorrow", "week", "later", "past"];

type Dated = { event_date: string | null; event_time?: string | null };

/** Groups bookings by when they are due. Inside a group: earliest first (past: most recent first). Bookings with no date go last. */
export function groupBookings<T extends Dated>(rows: T[], now: Date = new Date()): { bucket: Bucket; rows: T[] }[] {
  const by = new Map<Bucket, T[]>();
  const undated: T[] = [];
  for (const r of rows) {
    if (!r.event_date) { undated.push(r); continue; }
    const b = bucketOf(daysFromToday(r.event_date, now));
    by.set(b, [...(by.get(b) ?? []), r]);
  }
  const key = (r: T) => `${r.event_date}T${r.event_time ?? "99:99"}`;
  const out = BUCKET_ORDER.filter((b) => by.has(b)).map((b) => {
    const list = [...(by.get(b) ?? [])].sort((a, c) => (b === "past" ? key(c).localeCompare(key(a)) : key(a).localeCompare(key(c))));
    return { bucket: b, rows: list };
  });
  if (undated.length) {
    const later = out.find((g) => g.bucket === "later");
    if (later) later.rows.push(...undated); else out.splice(out.findIndex((g) => g.bucket === "past") === -1 ? out.length : out.findIndex((g) => g.bucket === "past"), 0, { bucket: "later", rows: undated });
  }
  return out;
}

/** A Nigerian phone number in the form WhatsApp links need (country code, no plus or spaces), or null if it cannot be read. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (/^234\d{10}$/.test(d)) return d;
  if (/^0\d{10}$/.test(d)) return `234${d.slice(1)}`;
  if (/^\d{10}$/.test(d)) return `234${d}`;
  return null;
}

export function reminderMessage(o: { customer: string; businessName: string; eventDate: string; eventTime?: string | null; balanceKobo: number }): string {
  const when = readBack(o.eventDate, o.eventTime);
  const pay = o.balanceKobo > 0 ? `The balance to pay is ${formatNaira(o.balanceKobo)}.` : "Your order is fully paid.";
  return `Hello ${o.customer}, this is a reminder from ${o.businessName}. Your order is on ${when}. ${pay} Thank you.`;
}

export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
