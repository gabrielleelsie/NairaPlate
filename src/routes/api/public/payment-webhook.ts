// payment-webhook: where the payment provider (Monnify) tells NairaPlate that money arrived. Public address, but nothing is accepted
// without a valid signature made with the shop's own secret key. Only this route (service key) can mark a transfer order Paid.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { parseMonnifyPayment, referenceOf, verifyMonnifySignature } from "@/lib/payments";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const MAX_BYTES = 100_000;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/payment-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!key) return json({ error: "Server is not configured." }, 500);
        const raw = await request.text();
        if (raw.length > MAX_BYTES) return json({ error: "Too large." }, 413);
        let body: unknown;
        try { body = JSON.parse(raw); } catch { return json({ error: "Bad request." }, 400); }

        // Which shop is this? Our own reference is the only way to know, so look it up first, then verify the signature
        // with THAT shop's secret before believing anything in the message.
        const reference = referenceOf(body);
        if (!reference) return json({ ignored: true });
        const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: pr } = await admin.from("payment_requests").select("business_id").eq("reference", reference).maybeSingle();
        if (!pr) return json({ ignored: true });
        const { data: conn } = await admin.rpc("read_payment_connection", { p_business_id: pr.business_id });
        const secret = (conn as { secret_key?: string } | null)?.secret_key ?? "";
        if (!(await verifyMonnifySignature(secret, raw, request.headers.get("monnify-signature")))) return json({ error: "Bad signature." }, 401);

        const payment = parseMonnifyPayment(body);
        if (!payment) return json({ ignored: true });
        const { data, error } = await admin.rpc("record_provider_payment", {
          p_provider: "monnify", p_event_id: payment.event_id, p_reference: payment.reference, p_amount_kobo: payment.amount_kobo, p_raw: body as never,
        });
        if (error) { console.error("record_provider_payment failed", error.message); return json({ error: "Could not record the payment." }, 500); }
        return json({ ok: true, outcome: (data as { outcome?: string } | null)?.outcome ?? "recorded" });
      },
    },
  },
});
