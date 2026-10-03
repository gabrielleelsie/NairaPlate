// Calendar entries for a catering order, so the customer (or staff) can save the event in any calendar app.
// Pure functions, no network. Times are Nigeria time (WAT, UTC+1, no daylight saving). No time on the order means an all-day entry.

export type CalendarOrder = { id: string; customer: string; businessName: string; eventDate: string; eventTime?: string | null; address?: string | null; summary?: string | null };

export type CalendarEvent = { title: string; description: string; location: string; allDay: boolean; start: Date | string; end: Date | string };

const WAT_HOURS = 1;
export const DEFAULT_HOURS = 2;

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
/** 20261004T130000Z */
export const utcStamp = (d: Date) => `${dateKey(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
/** "2026-10-04" -> "20261004" */
const plainDate = (key: string) => key.replace(/-/g, "");

function parseTime(time: string | null | undefined): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h > 23 || min > 59 ? null : [h, min];
}

/** The event as a calendar needs it. With a time: starts then (Nigeria time) for two hours. Without: an all-day entry (start and end are date keys, end is the next day). */
export function calendarEvent(o: CalendarOrder): CalendarEvent | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.eventDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const title = `${o.businessName}: catering order`;
  const parts = [`Order for ${o.customer}`];
  if (o.summary) parts.push(o.summary);
  const base = { title, description: parts.join("\n"), location: (o.address ?? "").trim() };
  const t = parseTime(o.eventTime);
  if (!t) {
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    return { ...base, allDay: true, start: o.eventDate, end: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}` };
  }
  const start = new Date(Date.UTC(y, mo - 1, d, t[0] - WAT_HOURS, t[1]));
  return { ...base, allDay: false, start, end: new Date(start.getTime() + DEFAULT_HOURS * 3_600_000) };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes are folded, as the calendar format requires. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The text of an .ics file (opens in Outlook, Google, Apple and others). It asks the calendar to alert one day before. */
export function icsFile(o: CalendarOrder, now: Date = new Date()): string | null {
  const e = calendarEvent(o);
  if (!e) return null;
  const when = e.allDay
    ? [`DTSTART;VALUE=DATE:${plainDate(e.start as string)}`, `DTEND;VALUE=DATE:${plainDate(e.end as string)}`]
    : [`DTSTART:${utcStamp(e.start as Date)}`, `DTEND:${utcStamp(e.end as Date)}`];
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NairaPlate//Catering//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${o.id}@nairaplate.com`, `DTSTAMP:${utcStamp(now)}`, ...when,
    `SUMMARY:${esc(e.title)}`, ...(e.location ? [`LOCATION:${esc(e.location)}`] : []), `DESCRIPTION:${esc(e.description)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D", `DESCRIPTION:${esc(e.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

const q = (pairs: [string, string][]) => pairs.filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export function googleCalendarUrl(o: CalendarOrder): string | null {
  const e = calendarEvent(o);
  if (!e) return null;
  const dates = e.allDay ? `${plainDate(e.start as string)}/${plainDate(e.end as string)}` : `${utcStamp(e.start as Date)}/${utcStamp(e.end as Date)}`;
  return `https://calendar.google.com/calendar/render?${q([["action", "TEMPLATE"], ["text", e.title], ["dates", dates], ["details", e.description], ["location", e.location]])}`;
}

export function outlookCalendarUrl(o: CalendarOrder): string | null {
  const e = calendarEvent(o);
  if (!e) return null;
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const start = e.allDay ? (e.start as string) : iso(e.start as Date);
  const end = e.allDay ? (e.end as string) : iso(e.end as Date);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q([["path", "/calendar/action/compose"], ["rru", "addevent"], ["subject", e.title], ["startdt", start], ["enddt", end], ["allday", e.allDay ? "true" : ""], ["body", e.description], ["location", e.location]])}`;
}

/** What to send the customer on WhatsApp: the Google and Outlook links. (The .ics file is shared as a file, not a link.) */
export function calendarMessage(o: CalendarOrder): string | null {
  const g = googleCalendarUrl(o), ol = outlookCalendarUrl(o);
  if (!g || !ol) return null;
  return `Hello ${o.customer}, to save your order from ${o.businessName} in your calendar:\nGoogle Calendar: ${g}\nOutlook: ${ol}\nThank you.`;
}

export const icsFileName = (o: Pick<CalendarOrder, "eventDate">) => `catering-order-${o.eventDate}.ics`;
