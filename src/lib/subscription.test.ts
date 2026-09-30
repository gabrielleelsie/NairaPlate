import { describe, expect, it } from "vitest";
import { accessState, termFor, trialEnd } from "./subscription";

// 23:59:59 WAT = 22:59:59 UTC on the same date.
const endIso = (date: string) => `${date}T22:59:59.000Z`;

describe("trialEnd", () => {
  it("normal day: approval day counts as day 1", () => {
    expect(trialEnd(new Date("2026-09-30T09:00:00Z")).toISOString()).toBe(endIso("2026-10-06"));
  });
  it("approval at 23:30 WAT still counts that Lagos day", () => {
    // 23:30 WAT on 30 Sep = 22:30 UTC on 30 Sep
    expect(trialEnd(new Date("2026-09-30T22:30:00Z")).toISOString()).toBe(endIso("2026-10-06"));
  });
});

describe("termFor", () => {
  it("expired: starts today", () => {
    const t = termFor(new Date("2026-09-01T22:59:59Z"), new Date("2026-09-30T09:00:00Z"), "monthly");
    expect(t.end.toISOString()).toBe(endIso("2026-10-29"));
  });
  it("early renewal stacks on the current end", () => {
    const t = termFor(new Date(endIso("2026-10-06")), new Date("2026-09-30T09:00:00Z"), "monthly");
    expect(t.start.toISOString()).toBe("2026-10-06T23:00:00.000Z"); // midnight WAT 7 Oct
    expect(t.end.toISOString()).toBe(endIso("2026-11-06"));
  });
  it("monthly from 31 January caps like Postgres", () => {
    const t = termFor(null, new Date("2027-01-31T09:00:00Z"), "monthly");
    expect(t.end.toISOString()).toBe(endIso("2027-02-27"));
  });
  it("yearly across a leap year", () => {
    const t = termFor(null, new Date("2028-02-29T09:00:00Z"), "yearly");
    expect(t.end.toISOString()).toBe(endIso("2029-02-27"));
    const q = termFor(null, new Date("2027-03-01T09:00:00Z"), "yearly");
    expect(q.end.toISOString()).toBe(endIso("2028-02-29"));
  });
});

describe("accessState", () => {
  it("counts days left in Lagos days", () => {
    const s = accessState({ status: "approved", access_ends_at: endIso("2026-10-02") }, new Date("2026-09-30T09:00:00Z"));
    expect(s.kind === "active" && s.daysLeft).toBe(3);
  });
  it("expired when end passed or missing", () => {
    expect(accessState({ status: "approved", access_ends_at: null }).kind).toBe("expired");
  });
});
