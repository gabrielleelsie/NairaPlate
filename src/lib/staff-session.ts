import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";

export type StaffSession = { userId: string; businessId: string; role: string; name: string };

/** Reads the signed-in staff member's business and role from their login (set by PIN sign-in). */
export function useStaffSession() {
  const [state, setState] = useState<{ loading: boolean; session: StaffSession | null }>({ loading: true, session: null });
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      const businessId = u?.app_metadata?.["business_id"];
      const role = u?.app_metadata?.["role"];
      if (!u || typeof businessId !== "string" || typeof role !== "string") return setState({ loading: false, session: null });
      setState({
        loading: false,
        session: { userId: u.id, businessId, role, name: String(u.user_metadata?.["display_name"] ?? "") },
      });
    });
  }, []);
  return state;
}

// The one canonical market-unit list. Values are stored; labels are shown to people.
// No unit carries a global size: each still needs a per-ingredient unit_conversions row.
export const MARKET_UNIT_OPTIONS = [
  { value: "derica", label: "derica" },
  { value: "paint_rubber", label: "paint rubber" },
  { value: "mudu", label: "mudu" },
  { value: "tuber", label: "tuber" },
  { value: "bag", label: "bag" },
  { value: "carton", label: "carton" },
  { value: "bottle", label: "bottle" },
  { value: "bunch", label: "bunch" },
  { value: "market_cup", label: "market cup" },
  { value: "congo", label: "congo" },
  { value: "tia", label: "tia" },
  { value: "milk_cup", label: "milk cup" },
  { value: "cigarette_cup", label: "cigarette cup" },
  { value: "basin", label: "basin" },
  { value: "heap", label: "heap" },
  { value: "sachet", label: "sachet" },
  { value: "bowl", label: "bowl" },
  { value: "jerry_can", label: "jerry can" },
  // Kitchen measures — same rule: each needs its own per-ingredient conversion.
  { value: "teaspoon", label: "teaspoon" },
  { value: "tablespoon", label: "tablespoon" },
  { value: "cooking_spoon", label: "cooking spoon" },
  { value: "measuring_cup", label: "measuring cup" },
] as const;

export const MARKET_UNITS = MARKET_UNIT_OPTIONS.map(({ value }) => value);

const MARKET_UNIT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  MARKET_UNIT_OPTIONS.map(({ value, label }) => [value, label]),
);

/** Formats a stored market-unit value without changing what is saved. */
export function marketUnitLabel(value: string): string {
  return MARKET_UNIT_LABELS[value] ?? value.replaceAll("_", " ");
}

export const BASE_UNITS = ["kg", "g", "L", "ml", "piece"] as const;
