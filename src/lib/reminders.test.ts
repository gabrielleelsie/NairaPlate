import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDERS, REMINDER_SCHEMA, dueReminder, mergeReminders, parseDays, renderReminder, whenPhrase } from "./reminders";

const S = DEFAULT_REMINDERS;
const at = (iso: string) => new Date(iso);
// Access ends 23:59:59 WAT = 22:59:59 UTC on the end date. End date 10 Oct 2026.
const END = "2026-10-10T22:59:59.000Z";
const paid = { status: "approved", plan: "monthly", access_ends_at: END };

describe("dueReminder: paid plan, defaults 7, 3, 1 before and 1 after", () => {
  it("is due exactly 7, 3 and 1 days before the end date (Nigeria days)", () => {
    expect(dueReminder(paid, at("2026-10-03T08:00:00Z"), S)).toMatchObject({ kind: "paid_before", offset: 7 });
    expect(dueReminder(paid, at("2026-10-07T08:00:00Z"), S)).toMatchObject({ kind: "paid_before", offset: 3 });
    expect(dueReminder(paid, at("2026-10-09T08:00:00Z"), S)).toMatchObject({ kind: "paid_before", offset: 1 });
  });
  it("is not due on other days, including the end date itself", () => {
    for (const d of ["2026-10-02", "2026-10-04", "2026-10-06", "2026-10-08", "2026-10-10"]) expect(dueReminder(paid, at(`${d}T08:00:00Z`), S)).toBeNull();
  });
  it("is due the day after it ended, once", () => {
    expect(dueReminder(paid, at("2026-10-11T08:00:00Z"), S)).toMatchObject({ kind: "paid_after", offset: 1 });
    expect(dueReminder(paid, at("2026-10-12T08:00:00Z"), S)).toBeNull();
  });
  it("uses the Nigeria date, not the UTC date, near midnight", () => {
    // 23:30 UTC on 9 Oct is 00:30 on 10 Oct in Lagos: the end date is today, so offset 0, not 1.
    expect(dueReminder(paid, at("2026-10-09T23:30:00Z"), S)).toBeNull();
    // 22:30 UTC on 8 Oct is 23:30 on 8 Oct in Lagos: 2 days before, not in the list.
    expect(dueReminder(paid, at("2026-10-08T22:30:00Z"), S)).toBeNull();
    expect(dueReminder(paid, at("2026-10-08T23:30:00Z"), S)).toMatchObject({ offset: 1 }); // 00:30 on 9 Oct in Lagos
  });
});

describe("dueReminder: trial and exclusions", () => {
  const trial = { status: "approved", plan: "trial", access_ends_at: END };
  it("uses the trial days (2 and 1 before, 1 after)", () => {
    expect(dueReminder(trial, at("2026-10-08T08:00:00Z"), S)).toMatchObject({ kind: "trial_before", offset: 2 });
    expect(dueReminder(trial, at("2026-10-09T08:00:00Z"), S)).toMatchObject({ kind: "trial_before", offset: 1 });
    expect(dueReminder(trial, at("2026-10-07T08:00:00Z"), S)).toBeNull(); // 3 days: a paid day, not a trial day
    expect(dueReminder(trial, at("2026-10-11T08:00:00Z"), S)).toMatchObject({ kind: "trial_after", offset: 1 }); // the day after the trial ended
    expect(dueReminder(trial, at("2026-10-12T08:00:00Z"), S)).toBeNull(); // only the day after, not every day
  });
  it("skips pending, suspended and rejected businesses and ones with no plan or end date", () => {
    for (const status of ["pending", "suspended", "rejected"]) expect(dueReminder({ ...paid, status }, at("2026-10-09T08:00:00Z"), S)).toBeNull();
    expect(dueReminder({ ...paid, plan: null }, at("2026-10-09T08:00:00Z"), S)).toBeNull();
    expect(dueReminder({ ...paid, access_ends_at: null }, at("2026-10-09T08:00:00Z"), S)).toBeNull();
  });
  it("follows changed settings", () => {
    const s = { ...S, paid_days_before: [10], paid_days_after: [2, 5] };
    expect(dueReminder(paid, at("2026-09-30T08:00:00Z"), s)).toMatchObject({ offset: 10 });
    expect(dueReminder(paid, at("2026-10-12T08:00:00Z"), s)).toMatchObject({ kind: "paid_after", offset: 2 });
    expect(dueReminder(paid, at("2026-10-15T08:00:00Z"), s)).toMatchObject({ offset: 5 });
  });
});

describe("settings", () => {
  it("defaults are valid and switched off", () => {
    expect(REMINDER_SCHEMA.safeParse(DEFAULT_REMINDERS).success).toBe(true);
    expect(DEFAULT_REMINDERS.enabled).toBe(false);
  });
  it("refuses bad hours, days and wording", () => {
    const bad = (over: object) => REMINDER_SCHEMA.safeParse({ ...DEFAULT_REMINDERS, ...over }).success;
    expect(bad({ send_hour: 24 })).toBe(false);
    expect(bad({ paid_days_before: [7, 7] })).toBe(false);
    expect(bad({ paid_days_after: [0] })).toBe(false);
    expect(bad({ paid_days_before: [1, 2, 3, 4, 5, 6, 7] })).toBe(false);
    expect(bad({ templates: { ...DEFAULT_REMINDERS.templates, paid_before: { subject: "<b>", body: "x" } } })).toBe(false);
    expect(bad({ templates: { ...DEFAULT_REMINDERS.templates, paid_before: { subject: "Hi {phone}", body: "x" } } })).toBe(false);
  });
  it("merge falls back to the defaults (off) for junk", () => {
    expect(mergeReminders(null)).toEqual(DEFAULT_REMINDERS);
    expect(mergeReminders({ enabled: true, send_hour: 99 })).toEqual(DEFAULT_REMINDERS);
    expect(mergeReminders({ enabled: true, send_hour: 8 })).toMatchObject({ enabled: true, send_hour: 8, paid_days_before: [7, 3, 1] });
  });
  it("parses day lists", () => {
    expect(parseDays("1, 3 7")).toEqual([7, 3, 1]);
    expect(parseDays("")).toEqual([]);
    expect(parseDays("3, x")).toBeUndefined();
    expect(parseDays("-1")).toBeUndefined();
  });
});

describe("renderReminder", () => {
  it("fills the wording and escapes everything typed", () => {
    const r = renderReminder(S, "paid_before", { name: "Mama <b>Put</b> & Sons", plan: "monthly" }, { offset: 3, ends_at: END });
    expect(r.subject).toBe("Your NairaPlate plan ends in 3 days");
    expect(r.html).toContain("Mama &lt;b&gt;Put&lt;/b&gt; &amp; Sons");
    expect(r.html).toContain("10 October 2026");
    expect(r.html).toContain("Monthly plan");
    expect(r.html).not.toContain("<b>Put");
    expect(r.html).toContain("wa.me/2349124766666");
  });
  it("marks a test email", () => {
    const r = renderReminder(S, "paid_after", { name: "X", plan: "yearly" }, { offset: 1, ends_at: END }, { test: true });
    expect(r.subject.startsWith("[Test] ")).toBe(true);
    expect(r.html).toContain("THIS IS A TEST");
  });
  it("says when in plain words", () => {
    expect(whenPhrase("paid_before", 0)).toBe("today");
    expect(whenPhrase("paid_before", 1)).toBe("tomorrow");
    expect(whenPhrase("paid_after", 1)).toBe("yesterday");
    expect(whenPhrase("trial_after", 4)).toBe("4 days ago");
  });
});
