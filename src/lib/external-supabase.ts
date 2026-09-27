// Client for the user's own external Supabase project (NairaPlate).
// The publishable key is safe to ship in browser code; RLS protects the data.
import { createClient } from "@supabase/supabase-js";

export const EXTERNAL_SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
export const EXTERNAL_SUPABASE_ANON_KEY = "sb_publishable_SmyfkPZXXB_yGEEeRwhZuw_DPo4Jx7z";

export const supabase = createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "nairaplate-external-auth",
  },
});
