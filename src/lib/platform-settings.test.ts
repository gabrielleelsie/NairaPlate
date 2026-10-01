import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTING_SCHEMAS, bannerWhen, formatPrice, mergeSettings, nairaTextToKobo, renderTemplate, unknownPlaceholders } from "./platform-settings";

describe("renderTemplate", () => {
  it("fills known placeholders and leaves unknown ones visible", () => {
    expect(renderTemplate("{business} ended {date}", { business: "Mama Put", date: "1 Oct" })).toBe("Mama Put ended 1 Oct");
    expect(renderTemplate("hi {oops}", {})).toBe("hi {oops}");
  });
  it("does not run anything or turn text into html", () => {
    expect(renderTemplate("{business}", { business: "<b>x</b>" })).toBe("<b>x</b>"); // React escapes it when shown
  });
});

describe("validation", () => {
  it("lists unknown placeholders", () => {
    expect(unknownPlaceholders("{business} {date} {nope}", ["business", "date"])).toEqual(["nope"]);
    expect(unknownPlaceholders("no braces", [])).toEqual([]);
  });
  it("accepts the built-in wording", () => {
    for (const k of ["prices", "locked_screen", "expiry_banner"] as const) expect(SETTING_SCHEMAS[k].safeParse(DEFAULT_SETTINGS[k]).success).toBe(true);
  });
  it("refuses html, unknown placeholders, empty text and over-long text", () => {
    const base = DEFAULT_SETTINGS.locked_screen;
    expect(SETTING_SCHEMAS.locked_screen.safeParse({ ...base, title: "<script>" }).success).toBe(false);
    expect(SETTING_SCHEMAS.locked_screen.safeParse({ ...base, intro: "{business} {phone}" }).success).toBe(false);
    expect(SETTING_SCHEMAS.locked_screen.safeParse({ ...base, title: "  " }).success).toBe(false);
    expect(SETTING_SCHEMAS.locked_screen.safeParse({ ...base, title: "x".repeat(91) }).success).toBe(false);
    expect(SETTING_SCHEMAS.locked_screen.safeParse({ ...base, steps: [] }).success).toBe(false);
    expect(SETTING_SCHEMAS.locked_screen.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(SETTING_SCHEMAS.expiry_banner.safeParse({ text: "ends {when} ({days})" }).success).toBe(true);
    expect(SETTING_SCHEMAS.expiry_banner.safeParse({ text: "ends {date}" }).success).toBe(false);
  });
  it("prices: whole kobo, at least ₦1, blank allowed", () => {
    expect(SETTING_SCHEMAS.prices.safeParse({ monthly_kobo: 500000, quarterly_kobo: null, yearly_kobo: null }).success).toBe(true);
    expect(SETTING_SCHEMAS.prices.safeParse({ monthly_kobo: 0, quarterly_kobo: null, yearly_kobo: null }).success).toBe(false);
    expect(SETTING_SCHEMAS.prices.safeParse({ monthly_kobo: 1.5, quarterly_kobo: null, yearly_kobo: null }).success).toBe(false);
    expect(SETTING_SCHEMAS.prices.safeParse({ monthly_kobo: -100, quarterly_kobo: null, yearly_kobo: null }).success).toBe(false);
  });
});

describe("mergeSettings", () => {
  it("gives the defaults for nothing, junk or a failed read", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it("uses a stored value, and falls back when a stored value is broken", () => {
    const m = mergeSettings({ expiry_banner: { text: "Plan ends {when}." }, locked_screen: { title: "<bad>" }, prices: { monthly_kobo: 1500000 } });
    expect(m.expiry_banner.text).toBe("Plan ends {when}.");
    expect(m.locked_screen).toEqual(DEFAULT_SETTINGS.locked_screen);
    expect(m.prices).toEqual({ monthly_kobo: 1500000, quarterly_kobo: null, yearly_kobo: null });
  });
});

describe("helpers", () => {
  it("parses naira text", () => {
    expect(nairaTextToKobo("15,000")).toBe(1500000);
    expect(nairaTextToKobo("₦1500.50")).toBe(150050);
    expect(nairaTextToKobo("")).toBeNull();
    expect(nairaTextToKobo("abc")).toBeUndefined();
    expect(nairaTextToKobo("1.234")).toBeUndefined();
  });
  it("formats prices and the banner phrase", () => {
    expect(formatPrice(1500000)).toBe("₦15,000");
    expect(formatPrice(null)).toBeNull();
    expect(bannerWhen(1)).toBe("today at 11:59 pm");
    expect(bannerWhen(2)).toBe("tomorrow at 11:59 pm");
    expect(bannerWhen(3)).toBe("in 2 days");
  });
});
