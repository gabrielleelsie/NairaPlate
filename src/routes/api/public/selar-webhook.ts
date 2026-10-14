// selar-webhook: where Selar (through Zapier) tells NairaPlate that a subscription payment was made.
// FIRST STAGE, LOGGING ONLY: a message with the right secret is saved as one audit line so we can see what Selar really sends.
// Nothing is recorded as a payment, no kitchen is activated and no email is sent. The shared secret lives in the database
// (platform_settings key "selar_webhook"), never in browser code, and is sent as ?token=... on the web address.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SELAR_MAX_BYTES, logLine, parseMessage, secretFromSetting, tokenMatches } from "@/lib/selar-intake";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const PLATFORM_BUSINESS = "platform";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/selar-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!key) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

        // Check the secret before reading anything else. A missing or wrong secret gets the same plain refusal.
        const { data: setting } = await admin.from("platform_settings").select("value").eq("key", "selar_webhook").maybeSingle();
        const secret = secretFromSetting(setting?.value);
        const sent = new URL(request.url).searchParams.get("token");
        if (!tokenMatches(sent, secret)) return json({ error: "Not accepted." }, 401);

        const raw = await request.text();
        if (raw.length > SELAR_MAX_BYTES) return json({ error: "Too large." }, 413);
        const parsed = parseMessage(raw, request.headers.get("content-type"));

        const { error } = await admin.from("audit_logs").insert({
          business_id: PLATFORM_BUSINESS,
          actor_id: null,
          actor_role: "selar",
          action: "selar_payload_received",
          entity_type: "selar",
          entity_id: null,
          details: logLine(raw, parsed),
        });
        // If the line could not be saved, say so, so the sender shows an error instead of looking successful.
        if (error) { console.error("selar log insert failed", error.message); return json({ error: "Could not save the message." }, 500); }
        // 200 so Selar and Zapier do not keep retrying a message we have already saved.
        return json({ ok: true, logged: true });
      },
    },
  },
});
