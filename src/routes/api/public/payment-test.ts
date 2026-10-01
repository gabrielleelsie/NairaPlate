// payment-test: an owner checks that the shop's saved Monnify keys still work. Uses the keys already stored in the vault, so the
// owner never has to type them again. A refusal from Monnify raises an Alert for the owner. A network problem does not.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { businessHasAccess, PLAN_ENDED } from "@/lib/subscription.server";
import { clearKeysAlert, monnifyLogin, raiseKeysAlert } from "@/lib/payment-keys.server";
import type { ProviderMode } from "@/lib/payments";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const OWNER_ROLES = new Set(["owner", "supa_admin"]);
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/payment-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!key) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Not signed in." }, 401);
        const { data: u, error: ue } = await admin.auth.getUser(token);
        if (ue || !u.user) return json({ error: "Session expired. Sign in again." }, 401);
        const meta = (u.user.app_metadata ?? {}) as Record<string, unknown>;
        const business_id = typeof meta["business_id"] === "string" ? meta["business_id"] : "";
        const role = typeof meta["role"] === "string" ? meta["role"] : "";
        if (!business_id || !OWNER_ROLES.has(role)) return json({ error: "Only an owner can test the connection." }, 403);
        if (!(await businessHasAccess(admin, business_id))) return json({ error: PLAN_ENDED }, 403);

        const { data: conn } = await admin.rpc("read_payment_connection", { p_business_id: business_id });
        const c = conn as { provider: string; status: ProviderMode; api_key: string; secret_key: string } | null;
        if (!c || c.provider !== "monnify") return json({ error: "No payment provider is connected yet." }, 409);

        const { result } = await monnifyLogin(c.status, c.api_key, c.secret_key);
        if (result === "ok") {
          await clearKeysAlert(admin, business_id);
          return json({ ok: true, status: c.status });
        }
        if (result === "rejected") {
          await raiseKeysAlert(admin, business_id);
          return json({ ok: false, reason: "rejected", error: `Monnify did not accept the saved keys for ${c.status} mode. Connect again with current keys.` }, 200);
        }
        return json({ ok: false, reason: "unreachable", error: "Could not reach Monnify just now. This is not a problem with your keys. Try again in a minute." }, 200);
      },
    },
  },
});
