import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { DEFAULT_SETTINGS, mergeSettings, type PlatformSettings } from "@/lib/platform-settings";

/** The prices and wording an admin has set. Shows the built-in text first, and keeps it if the lookup fails. */
export function usePublicSettings(): PlatformSettings {
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("public_settings" as never).then(({ data, error }) => {
      if (!cancelled && !error && data) setSettings(mergeSettings(data));
    });
    return () => { cancelled = true; };
  }, []);
  return settings;
}
