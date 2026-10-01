// Free-trial limits. The database enforces the same numbers
// (supabase/external/20261001_trial_limits.sql); this file is the friendly face of it:
// the numbers, the plan check, and the message to show when the database says no.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";

export const TRIAL_LIMITS = { recipes: 2, ingredientsPerRecipe: 12, ingredientsTotal: 20 } as const;

/** A business is on its free trial while its plan is "trial". Paid plans have no limits. */
export const isTrialPlan = (plan: string | null | undefined): boolean => plan === "trial";

/** The database's own wording starts with this; show it as it is, instead of a generic error. */
export function trialLimitMessage(message: string | null | undefined): string | null {
  return message && message.startsWith("Free trial limit:") ? message : null;
}

/** "1 of 2 recipes used" */
export function trialUsage(used: number, limit: number, noun: string): string {
  return `${Math.min(used, limit)} of ${limit} ${noun} used`;
}

/** The signed-in business's plan, or null until it is known. */
export function useBusinessPlan(enabled: boolean): string | null {
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    supabase.from("businesses").select("plan").maybeSingle().then(({ data }) => {
      if (alive) setPlan((data as { plan: string | null } | null)?.plan ?? null);
    });
    return () => { alive = false; };
  }, [enabled]);
  return plan;
}
