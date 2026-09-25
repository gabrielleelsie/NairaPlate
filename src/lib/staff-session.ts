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

export const MARKET_UNITS = [
  "derica", "paint_rubber", "mudu", "tuber", "bag", "carton", "bottle", "bunch", "cup", "congo", "tia",
] as const;
export const BASE_UNITS = ["kg", "g", "L", "ml", "piece"] as const;
