// Server-only helpers for checking a shop's Monnify keys and telling the owner when they stop working.
import type { SupabaseClient } from "@supabase/supabase-js";
import { basicAuth, classifyLogin, KEYS_ALERT_MESSAGE, KEYS_ALERT_TYPE, MONNIFY_BASE, type LoginResult, type ProviderMode } from "@/lib/payments";

export async function monnifyLogin(status: ProviderMode, apiKey: string, secretKey: string): Promise<{ result: LoginResult; token: string | null }> {
  try {
    const res = await fetch(`${MONNIFY_BASE[status]}/api/v1/auth/login`, { method: "POST", headers: { Authorization: basicAuth(apiKey, secretKey) }, signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    const result = classifyLogin(res.status, body);
    const token = result === "ok" ? ((body as { responseBody: { accessToken: string } }).responseBody.accessToken) : null;
    return { result, token };
  } catch {
    return { result: "unreachable", token: null };
  }
}

/** One open alert for the owner at a time. Does not repeat until the owner has marked it as seen. */
export async function raiseKeysAlert(admin: SupabaseClient, businessId: string): Promise<void> {
  const { data } = await admin.from("margin_flags").select("id").eq("business_id", businessId).eq("flag_type", KEYS_ALERT_TYPE).eq("acknowledged", false).limit(1);
  if (data && data.length > 0) return;
  const { error } = await admin.from("margin_flags").insert({ business_id: businessId, flag_type: KEYS_ALERT_TYPE, severity: "critical", message: KEYS_ALERT_MESSAGE, role: "owner", acknowledged: false });
  if (error) console.error("could not raise the payment keys alert", error.message);
}

/** The keys work again: the alert is no longer true. */
export async function clearKeysAlert(admin: SupabaseClient, businessId: string): Promise<void> {
  await admin.from("margin_flags").update({ acknowledged: true }).eq("business_id", businessId).eq("flag_type", KEYS_ALERT_TYPE).eq("acknowledged", false);
}
