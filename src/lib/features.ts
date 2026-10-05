import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";

export type OperatingMode = "buka" | "standard" | "advanced";
export const OPERATING_MODES: { value: OperatingMode; label: string }[] = [
  { value: "buka", label: "Buka (Simple)" },
  { value: "standard", label: "Restaurant (Standard)" },
  { value: "advanced", label: "Full Suite (Advanced)" },
];

export type FeatureName =
  | "customer_credit" | "catering" | "wastage" | "stock_take" | "receipt_capture"
  | "cost_check" | "cashflow" | "margin_diagnostic" | "accountant_exports"
  | "channel_payouts" | "audit_log" | "pricing_review";

/** Switches a platform admin can flip per kitchen, on top of its profile. */
export const OVERRIDABLE: { feature: FeatureName; label: string }[] = [
  { feature: "customer_credit", label: "Customer credit" },
  { feature: "receipt_capture", label: "Receipt photos" },
  { feature: "catering", label: "Catering orders" },
  { feature: "accountant_exports", label: "Accountant exports" },
  { feature: "margin_diagnostic", label: "Why did my margin change?" },
];

const ALL_ON: Record<FeatureName, boolean> = {
  customer_credit: true, catering: false, wastage: true, stock_take: true, receipt_capture: true,
  cost_check: true, cashflow: true, margin_diagnostic: true, accountant_exports: true,
  channel_payouts: true, audit_log: true, pricing_review: true,
};
// Catering stays off unless switched on, in every profile, exactly as before.
export const MODE_DEFAULTS: Record<OperatingMode, Record<FeatureName, boolean>> = {
  advanced: ALL_ON,
  standard: { ...ALL_ON, channel_payouts: false },
  buka: Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false])) as Record<FeatureName, boolean>,
};

export function hasFeature(mode: OperatingMode, feature: FeatureName, overrides?: Partial<Record<string, boolean>>): boolean {
  const o = overrides?.[feature];
  if (o !== undefined) return o;
  return MODE_DEFAULTS[mode][feature];
}

/** Standard shows a shorter margin answer and only the core 3 exports; advanced shows everything. */
export const MARGIN_DRIVER_LIMIT: Record<OperatingMode, number> = { buka: 2, standard: 2, advanced: 99 };
export const CORE_EXPORTS = ["sales_day_book", "cash_drawer_summary", "cash_paid_out_register"];

export const asMode = (v: unknown): OperatingMode => (v === "buka" || v === "standard" || v === "advanced" ? v : "advanced");

type Profile = { loading: boolean; mode: OperatingMode; overrides: Record<string, boolean> };

/** The signed-in kitchen's profile and switches. Until the database has a profile, everything behaves as Full Suite. */
export function useBusinessProfile() {
  const { session, loading } = useStaffSession();
  const [state, setState] = useState<Profile>({ loading: true, mode: "advanced", overrides: {} });
  useEffect(() => {
    if (loading) return;
    if (!session) return setState({ loading: false, mode: "advanced", overrides: {} });
    let cancelled = false;
    Promise.all([
      supabase.from("businesses").select("operating_mode" as never).eq("id", session.businessId).maybeSingle(),
      supabase.from("business_features" as never).select("feature, enabled"),
    ]).then(([biz, feats]) => {
      if (cancelled) return;
      const overrides: Record<string, boolean> = {};
      for (const r of ((feats.data ?? []) as { feature: string; enabled: boolean }[])) overrides[r.feature] = r.enabled === true;
      // A read error (e.g. column not added yet) keeps today's full behaviour.
      setState({ loading: false, mode: biz.error ? "advanced" : asMode((biz.data as { operating_mode?: string } | null)?.operating_mode), overrides });
    });
    return () => { cancelled = true; };
  }, [session, loading]);
  return { ...state, has: (f: FeatureName) => hasFeature(state.mode, f, state.overrides) };
}

/** Whether catering is switched on for the signed-in business. Off until we know, so nothing flashes on and then disappears. */
export function useCateringEnabled() {
  const p = useBusinessProfile();
  return { loading: p.loading, enabled: !p.loading && p.has("catering") };
}
