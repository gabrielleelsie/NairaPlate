import { describe, expect, it } from "vitest";
import { calendarEvent, calendarMessage, googleCalendarUrl, icsFile, icsFileName, outlookCalendarUrl, utcStamp } from "./catering-calendar";

const base = { id: "abc-123", customer: "Mama Ada", businessName: "Mama T's Kitchen", eventDate: "2026-10-04", eventTime: "14:00", address: "12 Allen Avenue, Ikeja", summary: "100 x Jollof Rice, 50 x Chicken" };
const NOW = new Date("2026-10-03T10:00:00Z");

describe("calendar event", () => {
  it("reads 14:00 Nigeria time as 13:00 UTC and lasts two hours", () => {
    const e = calendarEvent(base)!;
    expect(e.allDay).toBe(false);
    expect(utcStamp(e.start as Date)).toBe("20261004T130000Z");
    expect(utcStamp(e.end as Date)).toBe("20261004T150000Z");
  });
  it("a late-night time can fall on the day before in UTC", () => {
    const e = calendarEvent({ ...base, eventTime: "00:30" })!;
    expect(utcStamp(e.start as Date)).toBe("20261003T233000Z");
  });
  it("no time means an all-day entry ending the next day", () => {
    const e = calendarEvent({ ...base, eventTime: null })!;
    expect(e).toMatchObject({ allDay: true, start: "2026-10-04", end: "2026-10-05" });
  });
  it("the end of the month rolls over", () => {
    expect(calendarEvent({ ...base, eventDate: "2026-10-31", eventTime: null })!.end).toBe("2026-11-01");
  });
  it("a bad date or time is not turned into an entry", () => {
    expect(calendarEvent({ ...base, eventDate: "" })).toBeNull();
    expect(calendarEvent({ ...base, eventDate: "4 Oct" })).toBeNull();
    expect(calendarEvent({ ...base, eventTime: "25:00" })!.allDay).toBe(true);
  });
});

describe("ics file", () => {
  const ics = icsFile(base, NOW)!;
  it("is a complete calendar with one event and an alert one day before", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261004T130000Z");
    expect(ics).toContain("DTEND:20261004T150000Z");
    expect(ics).toContain("DTSTAMP:20261003T100000Z");
    expect(ics).toContain("UID:abc-123@nairaplate.com");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
  it("escapes commas, semicolons and new lines", () => {
    expect(ics).toContain("LOCATION:12 Allen Avenue\\, Ikeja");
    expect(ics).toContain("DESCRIPTION:Order for Mama Ada\\n100 x Jollof Rice\\, 50 x Chicken");
    expect(icsFile({ ...base, summary: "a;b" }, NOW)).toContain("a\\;b");
  });
  it("uses date values for an all-day entry", () => {
    const all = icsFile({ ...base, eventTime: null }, NOW)!;
    expect(all).toContain("DTSTART;VALUE=DATE:20261004");
    expect(all).toContain("DTEND;VALUE=DATE:20261005");
  });
  it("leaves out the location when there is no address", () => {
    expect(icsFile({ ...base, address: "" }, NOW)).not.toContain("LOCATION");
  });
  it("folds long lines at 75 bytes", () => {
    const long = icsFile({ ...base, summary: "x".repeat(200) }, NOW)!;
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long).toContain("\r\n x");
  });
  it("returns nothing without a valid date", () => { expect(icsFile({ ...base, eventDate: "" }, NOW)).toBeNull(); });
  it("names the file after the date", () => { expect(icsFileName(base)).toBe("catering-order-2026-10-04.ics"); });
});

describe("calendar links", () => {
  it("builds a Google link with the UTC times", () => {
    const u = googleCalendarUrl(base)!;
    expect(u.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE")).toBe(true);
    expect(u).toContain("dates=20261004T130000Z%2F20261004T150000Z");
    expect(u).toContain("location=12%20Allen%20Avenue%2C%20Ikeja");
  });
  it("builds an Outlook link", () => {
    const u = outlookCalendarUrl(base)!;
    expect(u.startsWith("https://outlook.live.com/calendar/0/deeplink/compose?")).toBe(true);
    expect(u).toContain("startdt=2026-10-04T13%3A00%3A00Z");
    expect(u).toContain("enddt=2026-10-04T15%3A00%3A00Z");
    expect(u).not.toContain("allday");
  });
  it("marks an all-day Outlook entry", () => {
    const u = outlookCalendarUrl({ ...base, eventTime: null })!;
    expect(u).toContain("allday=true");
    expect(u).toContain("startdt=2026-10-04");
  });
  it("carries a customer name with odd characters safely", () => {
    const u = googleCalendarUrl({ ...base, customer: "A&B <x>" })!;
    expect(u).not.toContain("<x>");
    expect(u).toContain("A%26B");
  });
  it("the WhatsApp message holds both links and no price", () => {
    const m = calendarMessage(base)!;
    expect(m).toContain("Hello Mama Ada");
    expect(m).toContain("Google Calendar: https://calendar.google.com");
    expect(m).toContain("Outlook: https://outlook.live.com");
    expect(m).not.toMatch(/₦|balance/i);
  });
});
