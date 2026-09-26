// Server-only audit logging for events that happen in server routes (login, staff, drawer).
// Database-side events (cost changes, order adjustments, price publishes) are logged by triggers.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntry = {
  business_id: string;
  actor_id: string | null;
  actor_role: string | null;
  action:
    | "login_success" | "login_failed" | "account_locked"
    | "staff_created" | "role_changed" | "staff_deactivated" | "pin_reset"
    | "drawer_discrepancy"
    // Platform admin support actions. Every one names the individual admin in actor_id.
    | "platform_unlock_staff" | "emergency_owner_pin_reset"
    | "emergency_reset_blocked" | "security_alert_undelivered"
    | "business_approved" | "business_rejected" | "business_suspended" | "business_reactivated";
  entity_type?: string | null;
  entity_id?: string | null;
  details?: string | null;
};

/** Never throws: a logging failure must not break the action itself. Never pass PINs here. */
export async function writeAudit(admin: SupabaseClient, e: AuditEntry): Promise<void> {
  try {
    const { error } = await admin.from("audit_logs").insert({
      business_id: e.business_id, actor_id: e.actor_id, actor_role: e.actor_role, action: e.action,
      entity_type: e.entity_type ?? null, entity_id: e.entity_id ?? null, details: e.details ?? null,
    });
    if (error) console.error("audit log insert failed", error.message);
  } catch (err) {
    console.error("audit log insert failed", err);
  }
}
