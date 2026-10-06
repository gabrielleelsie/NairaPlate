import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTING_SCHEMAS, bannerWhen, formatPrice, mergeSettings, monthlyPricesSentence, nairaTextToKobo, planPriceInput, renderTemplate, savingPercent, setupFeesSentence, setupText, unknownPlaceholders } from "./platform-settings";

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
    const blank = { monthly_kobo: null, quarterly_kobo: null, yearly_kobo: null, setup_kobo: null, setup_from: false };
    const withPlans = (buka: object) => ({ plans: { ...DEFAULT_SETTINGS.prices.plans, buka } });
    expect(SETTING_SCHEMAS.prices.safeParse(withPlans({ ...blank, monthly_kobo: 500000 })).success).toBe(true);
    expect(SETTING_SCHEMAS.prices.safeParse(withPlans(blank)).success).toBe(true);
    expect(SETTING_SCHEMAS.prices.safeParse(withPlans({ ...blank, monthly_kobo: 0 })).success).toBe(false);
    expect(SETTING_SCHEMAS.prices.safeParse(withPlans({ ...blank, setup_kobo: 1.5 })).success).toBe(false);
    expect(SETTING_SCHEMAS.prices.safeParse(withPlans({ ...blank, yearly_kobo: -100 })).success).toBe(false);
    expect(SETTING_SCHEMAS.prices.safeParse({ plans: { buka: blank } }).success).toBe(false); // all three plans are required
  });
});

describe("mergeSettings", () => {
  it("gives the defaults for nothing, junk or a failed read", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it("uses a stored value, and falls back when a stored value is broken", () => {
    const m = mergeSettings({ expiry_banner: { text: "Plan ends {when}." }, locked_screen: { title: "<bad>" }, prices: { monthly_kobo: 1500000 } }); // the old single price list no longer fits, so the standard list shows
    expect(m.expiry_banner.text).toBe("Plan ends {when}.");
    expect(m.locked_screen).toEqual(DEFAULT_SETTINGS.locked_screen);
    expect(m.prices).toEqual(DEFAULT_SETTINGS.prices);
    const own = { plans: { ...DEFAULT_SETTINGS.prices.plans, buka: { ...DEFAULT_SETTINGS.prices.plans.buka, monthly_kobo: 600000 } } };
    expect(mergeSettings({ prices: own }).prices.plans.buka.monthly_kobo).toBe(600000);
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

describe("planPriceInput", () => {
  const prices = DEFAULT_SETTINGS.prices;
  it("gives the price of the business's plan in whole naira", () => {
    expect(planPriceInput(prices, "buka", "monthly")).toBe("5000");
    expect(planPriceInput(prices, "standard", "quarterly")).toBe("27000");
    expect(planPriceInput(prices, "advanced", "yearly")).toBe("192000");
  });
  it("is empty when no price is set, no profile is known or nothing has loaded", () => {
    const blank = { plans: { ...prices.plans, buka: { ...prices.plans.buka, yearly_kobo: null } } };
    expect(planPriceInput(blank, "buka", "yearly")).toBe("");
    expect(planPriceInput(prices, null, "monthly")).toBe("");
    expect(planPriceInput(null, "buka", "monthly")).toBe("");
  });
});

describe("the agreed price list", () => {
  const p = DEFAULT_SETTINGS.prices.plans;
  it("3 months saves 10% and 12 months saves 20% on every plan", () => {
    for (const m of ["buka", "standard", "advanced"] as const) {
      expect(savingPercent(p[m], "quarterly")).toBe(10);
      expect(savingPercent(p[m], "yearly")).toBe(20);
    }
  });
  it("savings are worked out from the prices, so an edited price never shows a wrong percent", () => {
    expect(savingPercent({ ...p.buka, quarterly_kobo: 1_500_000 }, "quarterly")).toBeNull(); // 15,000 = 3 x 5,000, no saving
    expect(savingPercent({ ...p.buka, monthly_kobo: null }, "yearly")).toBeNull();
  });
  it("sentences for the FAQ", () => {
    expect(monthlyPricesSentence(DEFAULT_SETTINGS.prices)).toBe("Buka ₦5,000 a month, Restaurant ₦10,000 a month, Full Suite ₦20,000 a month.");
    expect(setupFeesSentence(DEFAULT_SETTINGS.prices)).toBe("Buka ₦10,000, Restaurant ₦15,000, Full Suite from ₦25,000.");
    expect(setupText({ ...p.buka, setup_kobo: null })).toBeNull();
    const none = { plans: { buka: { ...p.buka, monthly_kobo: null, setup_kobo: null }, standard: { ...p.standard, monthly_kobo: null, setup_kobo: null }, advanced: { ...p.advanced, monthly_kobo: null, setup_kobo: null } } };
    expect(monthlyPricesSentence(none)).toBe("");
    expect(setupFeesSentence(none)).toBe("");
  });
});
