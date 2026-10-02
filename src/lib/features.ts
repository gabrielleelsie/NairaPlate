import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";

/** Whether catering is switched on for the signed-in business. Off until we know, so nothing flashes on and then disappears. */
export function useCateringEnabled() {
  const { session, loading } = useStaffSession();
  const [state, setState] = useState<{ loading: boolean; enabled: boolean }>({ loading: true, enabled: false });
  useEffect(() => {
    if (loading) return;
    if (!session) return setState({ loading: false, enabled: false });
    let cancelled = false;
    supabase.from("business_features" as never).select("enabled").eq("feature", "catering").maybeSingle()
      .then(({ data }) => { if (!cancelled) setState({ loading: false, enabled: (data as { enabled?: boolean } | null)?.enabled === true }); });
    return () => { cancelled = true; };
  }, [session, loading]);
  return state;
}
