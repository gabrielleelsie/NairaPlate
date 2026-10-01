// payment-connect: an owner connects the shop's payment provider (Monnify first). The keys are checked with a real login call to the
// provider, then stored in the database vault. They are never returned to the browser and never written to a log.
// The caller's business and role come ONLY from the verified login token.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit.server";
import { businessHasAccess, PLAN_ENDED } from "@/lib/subscription.server";
import { basicAuth, ConnectBody, MONNIFY_BASE } from "@/lib/payments";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const OWNER_ROLES = new Set(["owner", "supa_admin"]);
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/payment-connect")({
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
        if (!business_id || !OWNER_ROLES.has(role)) return json({ error: "Only an owner can connect a payment provider." }, 403);
        if (!(await businessHasAccess(admin, business_id))) return json({ error: PLAN_ENDED }, 403);

        const parsed = ConnectBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Enter the API key, secret key and contract code from your Monnify dashboard." }, 400);
        const b = parsed.data;

        // Prove the keys work by logging in to the provider. (Monnify: POST /api/v1/auth/login with Basic apiKey:secretKey.)
        let ok = false;
        try {
          const res = await fetch(`${MONNIFY_BASE[b.status]}/api/v1/auth/login`, {
            method: "POST", headers: { Authorization: basicAuth(b.api_key, b.secret_key), "Content-Type": "application/json" },
            signal: AbortSignal.timeout(10000),
          });
          const j = (await res.json().catch(() => null)) as { requestSuccessful?: boolean; responseBody?: { accessToken?: string } } | null;
          ok = res.ok && j?.requestSuccessful === true && typeof j.responseBody?.accessToken === "string";
        } catch {
          return json({ error: "Could not reach Monnify. Try again in a minute." }, 502);
        }
        if (!ok) return json({ error: `Monnify did not accept these keys for ${b.status} mode. Check them on your Monnify dashboard (test keys for test mode, live keys for live mode).` }, 400);

        const { data: staff } = await admin.from("staff_users").select("display_name").eq("id", u.user.id).maybeSingle();
        const { error: se } = await admin.rpc("save_payment_connection", {
          p_business_id: business_id, p_provider: b.provider, p_status: b.status, p_contract_code: b.contract_code,
          p_api_key: b.api_key, p_secret_key: b.secret_key, p_by_name: staff?.display_name ?? null,
        });
        if (se) return json({ error: "The keys were accepted but could not be saved. Try again." }, 500);
        await writeAudit(admin, { business_id, actor_id: u.user.id, actor_role: role, action: "payment_provider_connected", entity_type: "business_payment_settings", details: `${staff?.display_name ?? "Owner"} connected ${b.provider} in ${b.status} mode` });
        return json({ ok: true, provider: b.provider, status: b.status });
      },
    },
  },
});
