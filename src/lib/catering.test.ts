import { describe, expect, it } from "vitest";
import { bucketOf, daysFromToday, distanceLabel, eventDateLabel, groupBookings, longDate, readBack, reminderMessage, timeLabel, whatsappNumber, whatsappUrl } from "./catering";

// 2 Oct 2026, 10:00 Nigeria time = 09:00 UTC
const NOW = new Date("2026-10-02T09:00:00Z");

describe("dates", () => {
  it("counts days in Nigeria time", () => {
    expect(daysFromToday("2026-10-02", NOW)).toBe(0);
    expect(daysFromToday("2026-10-03", NOW)).toBe(1);
    expect(daysFromToday("2026-10-01", NOW)).toBe(-1);
    expect(daysFromToday("2026-10-12", NOW)).toBe(10);
  });
  it("late evening UTC is already tomorrow in Nigeria", () => {
    const lateUtc = new Date("2026-10-02T23:30:00Z"); // 00:30 on 3 Oct in Nigeria
    expect(daysFromToday("2026-10-03", lateUtc)).toBe(0);
  });
  it("names the weekday", () => {
    expect(longDate("2026-10-04")).toBe("Sunday 4 October 2026");
    expect(longDate("2026-10-03")).toBe("Saturday 3 October 2026");
  });
  it("says how far away it is", () => {
    expect(eventDateLabel("2026-10-04", NOW)).toBe("Sunday 4 October 2026 (in 2 days)");
    expect(distanceLabel(0)).toBe("today");
    expect(distanceLabel(1)).toBe("tomorrow");
    expect(distanceLabel(-3)).toBe("3 days ago");
  });
});

describe("times", () => {
  it("12-hour clock", () => {
    expect(timeLabel("14:00")).toBe("2:00 pm");
    expect(timeLabel("14:30:00")).toBe("2:30 pm");
    expect(timeLabel("00:15")).toBe("12:15 am");
    expect(timeLabel("12:00")).toBe("12:00 pm");
    expect(timeLabel("09:05")).toBe("9:05 am");
  });
  it("empty for no or bad time", () => {
    expect(timeLabel(null)).toBe("");
    expect(timeLabel("")).toBe("");
    expect(timeLabel("25:00")).toBe("");
  });
  it("reads a booking back in words", () => {
    expect(readBack("2026-10-03", "14:00")).toBe("Saturday 3 October 2026 at 2:00 pm");
    expect(readBack("2026-10-03", null)).toBe("Saturday 3 October 2026");
  });
});

describe("grouping", () => {
  it("buckets by distance", () => {
    expect([-1, 0, 1, 2, 7, 8].map(bucketOf)).toEqual(["past", "today", "tomorrow", "week", "week", "later"]);
  });
  it("orders groups, earliest first, and past most recent first", () => {
    const rows = [
      { id: "a", event_date: "2026-10-20", event_time: "10:00" },
      { id: "b", event_date: "2026-10-02", event_time: "16:00" },
      { id: "c", event_date: "2026-10-02", event_time: "09:00" },
      { id: "d", event_date: "2026-09-20", event_time: "10:00" },
      { id: "e", event_date: "2026-09-28", event_time: "10:00" },
      { id: "f", event_date: "2026-10-03", event_time: null },
    ];
    const g = groupBookings(rows, NOW);
    expect(g.map((x) => x.bucket)).toEqual(["today", "tomorrow", "later", "past"]);
    expect(g[0]!.rows.map((r) => r.id)).toEqual(["c", "b"]);
    expect(g[3]!.rows.map((r) => r.id)).toEqual(["e", "d"]);
  });
  it("puts a booking with no date at the end of Later", () => {
    const g = groupBookings([{ id: "x", event_date: null }, { id: "y", event_date: "2026-10-30" }], NOW);
    expect(g.find((x) => x.bucket === "later")!.rows.map((r) => r.id)).toEqual(["y", "x"]);
  });
});

describe("whatsapp", () => {
  it("reads Nigerian numbers", () => {
    expect(whatsappNumber("0803 123 4567")).toBe("2348031234567");
    expect(whatsappNumber("+234 803 123 4567")).toBe("2348031234567");
    expect(whatsappNumber("8031234567")).toBe("2348031234567");
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
  it("builds the link with the message", () => {
    const text = reminderMessage({ customer: "Mama Ada", businessName: "Mama T's Kitchen", eventDate: "2026-10-03", eventTime: "14:00", balanceKobo: 4_500_000 });
    expect(text).toContain("Saturday 3 October 2026 at 2:00 pm");
    expect(text).toContain("₦45,000");
    const url = whatsappUrl("08031234567", text)!;
    expect(url.startsWith("https://wa.me/2348031234567?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(text);
    expect(whatsappUrl("nope", text)).toBeNull();
  });
  it("says fully paid when there is no balance", () => {
    expect(reminderMessage({ customer: "A", businessName: "B", eventDate: "2026-10-03", balanceKobo: 0 })).toContain("fully paid");
  });
});
