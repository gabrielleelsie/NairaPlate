// Platform settings an admin can change without a code change: plan prices and the wording customers see.
// Used by the browser (to show the text), the server (to validate what an admin saves) and the admin screen.
// Every field has a built-in default, so a missing or broken setting can never blank a screen.
import { z } from "zod";
import type { OperatingMode } from "@/lib/features";

export type SettingKey = "prices" | "locked_screen" | "expiry_banner";
export const SETTING_KEYS: SettingKey[] = ["prices", "locked_screen", "expiry_banner"];
export const SETTING_LABEL: Record<SettingKey, string> = { prices: "Plan prices", locked_screen: "Locked screen wording", expiry_banner: "Expiry warning banner" };

export type PlanKey = "monthly" | "quarterly" | "yearly";
export const PLAN_MODES: OperatingMode[] = ["buka", "standard", "advanced"];
/** The names customers see for the three operating profiles. */
export const PLAN_NAME: Record<OperatingMode, string> = { buka: "Buka", standard: "Restaurant", advanced: "Full Suite" };
export type PlanPrice = { monthly_kobo: number | null; quarterly_kobo: number | null; yearly_kobo: number | null; setup_kobo: number | null; setup_from: boolean };
export type Prices = { plans: Record<OperatingMode, PlanPrice> };
export type LockedScreenText = { title: string; intro: string; intro_no_date: string; steps: string[]; whatsapp_message: string };
export type ExpiryBannerText = { text: string };
export type PlatformSettings = { prices: Prices; locked_screen: LockedScreenText; expiry_banner: ExpiryBannerText };

export const DEFAULT_SETTINGS: PlatformSettings = {
  // The agreed price list. An admin can change any box; a blank box shows no price on the website.
  prices: {
    plans: {
      buka: { monthly_kobo: 500_000, quarterly_kobo: 1_350_000, yearly_kobo: 4_800_000, setup_kobo: 1_000_000, setup_from: false },
      standard: { monthly_kobo: 1_000_000, quarterly_kobo: 2_700_000, yearly_kobo: 9_600_000, setup_kobo: 1_500_000, setup_from: false },
      advanced: { monthly_kobo: 2_000_000, quarterly_kobo: 5_400_000, yearly_kobo: 19_200_000, setup_kobo: 2_500_000, setup_from: true },
    },
  },
  locked_screen: {
    title: "Your NairaPlate plan has ended",
    intro: "{business} had access until {date}. Your records are safe and nothing has been deleted.",
    intro_no_date: "{business} has no active plan. Your records are safe and nothing has been deleted.",
    steps: [
      "Message us on WhatsApp and tell us the plan you want.",
      "Pay using the details we send you.",
      "We confirm your payment and switch your account back on.",
    ],
    whatsapp_message: "Hello NairaPlate, my plan has ended and I would like to renew.",
  },
  expiry_banner: { text: "Your NairaPlate plan ends {when}. Message us on WhatsApp to renew and keep working without a break." },
};

// Which {placeholders} each text field may use. Anything else is refused on save.
export const PLACEHOLDERS = {
  locked_screen: { title: [], intro: ["business", "date"], intro_no_date: ["business"], steps: [], whatsapp_message: ["business"] },
  expiry_banner: { text: ["when", "days"] },
} as const;

export function unknownPlaceholders(text: string, allowed: readonly string[]): string[] {
  const found = [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? "");
  return [...new Set(found.filter((n) => !allowed.includes(n)))];
}

/** Fills known {placeholders}. Plain text only: the result is shown as text, never as HTML. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? vars[name]! : whole));
}

export const plain = (max: number, allowed: readonly string[], label: string) =>
  z.string().trim().min(1, `${label} cannot be empty.`).max(max, `${label} is too long (most ${max} characters).`)
    .refine((s) => !/[<>]/.test(s), `${label}: plain text only, no < or >.`)
    .refine((s) => unknownPlaceholders(s, allowed).length === 0, (s) => ({
      message: `${label}: unknown placeholder ${unknownPlaceholders(s, allowed).map((n) => `{${n}}`).join(", ")}. ${allowed.length ? `You can use ${allowed.map((n) => `{${n}}`).join(", ")}.` : "This line takes no placeholders."}`,
    }));

const price = z.number().int("Enter a whole number of kobo.").min(100, "A price must be at least ₦1.").max(10_000_000_000, "That price is too large.").nullable();

const planPrice = z.object({ monthly_kobo: price, quarterly_kobo: price, yearly_kobo: price, setup_kobo: price, setup_from: z.boolean() }).strict();

export const SETTING_SCHEMAS = {
  prices: z.object({
    plans: z.object({ buka: planPrice, standard: planPrice, advanced: planPrice }).strict(),
  }).strict(),
  locked_screen: z.object({
    title: plain(90, PLACEHOLDERS.locked_screen.title, "Title"),
    intro: plain(300, PLACEHOLDERS.locked_screen.intro, "Opening line (with date)"),
    intro_no_date: plain(300, PLACEHOLDERS.locked_screen.intro_no_date, "Opening line (no date)"),
    steps: z.array(plain(160, PLACEHOLDERS.locked_screen.steps, "Step")).min(1, "Add at least one step.").max(6, "Use six steps at most."),
    whatsapp_message: plain(200, PLACEHOLDERS.locked_screen.whatsapp_message, "WhatsApp message"),
  }).strict(),
  expiry_banner: z.object({ text: plain(220, PLACEHOLDERS.expiry_banner.text, "Banner text") }).strict(),
} as const;

/** Merges whatever is stored with the defaults. A stored value that no longer validates falls back to its default. */
export function mergeSettings(raw: unknown): PlatformSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <K extends SettingKey>(key: K): PlatformSettings[K] => {
    const stored = r[key];
    if (stored && typeof stored === "object") {
      const merged = { ...DEFAULT_SETTINGS[key], ...(stored as object) };
      const ok = SETTING_SCHEMAS[key].safeParse(merged);
      if (ok.success) return ok.data as PlatformSettings[K];
    }
    return DEFAULT_SETTINGS[key];
  };
  return { prices: pick("prices"), locked_screen: pick("locked_screen"), expiry_banner: pick("expiry_banner") };
}

export function formatPrice(kobo: number | null): string | null {
  return kobo === null ? null : `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

/** "15,000" or "15000.50" to kobo. Blank means no price. Returns undefined for something that is not a number. */
export function nairaTextToKobo(text: string): number | null | undefined {
  const t = text.replace(/[,\s₦]/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

/** The "when" phrase in the expiry banner: daysLeft counts calendar days including today (ends today = 1). */
export function bannerWhen(daysLeft: number): string {
  return daysLeft <= 1 ? "today at 11:59 pm" : daysLeft === 2 ? "tomorrow at 11:59 pm" : `in ${daysLeft - 1} days`;
}

/** The price as the admin types it (whole naira), or "" when no price is set. Used to pre-fill the amount on Record payment. */
export function planPriceInput(prices: Prices | null | undefined, mode: OperatingMode | null | undefined, plan: PlanKey): string {
  const k = mode ? prices?.plans?.[mode]?.[`${plan}_kobo` as const] : null;
  return typeof k === "number" && k > 0 ? String(k / 100) : "";
}

/** How much a 3-month or 12-month price saves against paying month by month, as a whole percent. Null when it saves nothing or a price is missing. */
export function savingPercent(p: PlanPrice, plan: "quarterly" | "yearly"): number | null {
  const m = p.monthly_kobo, k = p[`${plan}_kobo` as const];
  if (m === null || k === null) return null;
  const full = m * (plan === "quarterly" ? 3 : 12);
  const pct = Math.round((1 - k / full) * 100);
  return pct > 0 ? pct : null;
}

/** "₦5,000", or "from ₦25,000" when the admin marked the setup fee as a starting amount. Null when not set. */
export function setupText(p: PlanPrice): string | null {
  const f = formatPrice(p.setup_kobo);
  return f ? (p.setup_from ? `from ${f}` : f) : null;
}

/** One sentence for the FAQ: "Buka ₦5,000 a month, Restaurant ₦10,000 a month, Full Suite ₦20,000 a month." Empty when no price is set. */
export function monthlyPricesSentence(prices: Prices): string {
  const parts = PLAN_MODES.flatMap((m) => { const f = formatPrice(prices.plans[m].monthly_kobo); return f ? [`${PLAN_NAME[m]} ${f} a month`] : []; });
  return parts.length ? `${parts.join(", ")}.` : "";
}

export function setupFeesSentence(prices: Prices): string {
  const parts = PLAN_MODES.flatMap((m) => { const t = setupText(prices.plans[m]); return t ? [`${PLAN_NAME[m]} ${t}`] : []; });
  return parts.length ? `${parts.join(", ")}.` : "";
}
