// Who is subscribing: checks a store code and owner email together, and whether the store's setup fee is already paid.
// Server only. Never says why a check failed, so it cannot be used to find out which stores or emails exist.
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike, normalizeEmail } from "@/lib/selar-intake";

export type OwnerCheck = { ok: true; businessId: string; businessName: string; status: string; email: string } | { ok: false };

/** An active owner of this store with exactly this email, and a store that is waiting, approved or suspended. */
export async function verifyOwnerEmail(admin: SupabaseClient, businessId: string, emailRaw: string): Promise<OwnerCheck> {
  const email = normalizeEmail(emailRaw);
  const id = businessId.trim().toLowerCase();
  if (!email || !id) return { ok: false };
  const { data: owner } = await admin.from("staff_users").select("id").eq("business_id", id).eq("role", "owner").eq("is_active", true).ilike("email", escapeLike(email)).limit(1).maybeSingle();
  if (!owner) return { ok: false };
  const { data: biz } = await admin.from("businesses").select("id, name, status").eq("id", id).maybeSingle();
  if (!biz || (biz.status !== "pending" && biz.status !== "approved" && biz.status !== "suspended")) return { ok: false };
  return { ok: true, businessId: biz.id, businessName: biz.name, status: biz.status, email };
}

/** True when a setup fee is already recorded for the store: an approved Selar setup payment, or a payment that included setup. */
export async function setupFeePaid(admin: SupabaseClient, businessId: string): Promise<boolean> {
  const { data: viaSelar, error: selarErr } = await admin.from("selar_payments").select("id").eq("matched_business_id", businessId).eq("setup_guess", true).eq("status", "approved").limit(1);
  if (!selarErr && (viaSelar ?? []).length > 0) return true;
  const { data: viaPayment } = await admin.from("subscription_payments").select("id").eq("business_id", businessId).gt("setup_fee_kobo", 0).limit(1);
  return (viaPayment ?? []).length > 0;
}

/**
 * The plan type (Buka, Restaurant or Full Suite) a store was given when it was approved, or null when there is none to show.
 * A store still waiting for approval has no real plan type yet, so it gets null and the plan page shows every plan.
 */
export async function ownPlanMode(admin: SupabaseClient, businessId: string): Promise<"buka" | "standard" | "advanced" | null> {
  const { data, error } = await admin.from("businesses").select("status, operating_mode" as never).eq("id", businessId).maybeSingle();
  if (error || !data) return null;
  const row = data as { status?: string; operating_mode?: string | null };
  if (row.status !== "approved" && row.status !== "suspended") return null;
  const m = row.operating_mode;
  return m === "buka" || m === "standard" || m === "advanced" ? m : null;
}
