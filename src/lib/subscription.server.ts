import type { SupabaseClient } from "@supabase/supabase-js";

/** Live-row check, same rule as the database helper: approved and access_ends_at in the future. */
export async function businessHasAccess(admin: SupabaseClient, businessId: string): Promise<boolean> {
  const { data } = await admin.from("businesses").select("status, access_ends_at").eq("id", businessId).maybeSingle();
  return !!data && data.status === "approved" && !!data.access_ends_at && new Date(data.access_ends_at).getTime() > Date.now();
}

export const PLAN_ENDED = "Your NairaPlate plan has ended";
