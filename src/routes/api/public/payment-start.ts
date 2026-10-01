// payment-start: after the Till creates a transfer order, this asks the provider for a one-time account number for it and saves it
// on the payment request. The caller's business and role come ONLY from the verified login token. Safe to call again: an account
// that already exists is returned as it is.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { businessHasAccess, PLAN_ENDED } from "@/lib/subscription.server";
import { basicAuth, MONNIFY_BASE, parseTransferAccount, type ProviderMode } from "@/lib/payments";
import { monnifyLogin, raiseKeysAlert } from "@/lib/payment-keys.server";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const TILL_ROLES = new Set(["cashier", "owner", "supa_admin"]);
const Body = z.object({ request_id: z.string().uuid() }).strict();
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/payment-start")({
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
        if (!business_id || !TILL_ROLES.has(role)) return json({ error: "Only cashiers and owners take orders." }, 403);
        if (!(await businessHasAccess(admin, business_id))) return json({ error: PLAN_ENDED }, 403);

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Bad request." }, 400);

        const { data: pr } = await admin.from("payment_requests").select("id, order_id, reference, amount_kobo, status, account_number, bank_name, account_name, expires_at")
          .eq("id", parsed.data.request_id).eq("business_id", business_id).maybeSingle();
        if (!pr) return json({ error: "Payment request not found." }, 404);
        if (pr.account_number) return json({ account_number: pr.account_number, bank_name: pr.bank_name, account_name: pr.account_name, expires_at: pr.expires_at, reference: pr.reference });
        if (pr.status !== "waiting") return json({ error: "This order is not waiting for a payment." }, 409);

        const { data: conn } = await admin.rpc("read_payment_connection", { p_business_id: business_id });
        const c = conn as { provider: string; status: ProviderMode; contract_code: string; api_key: string; secret_key: string; mode: string } | null;
        if (!c || c.provider !== "monnify" || c.mode !== "automatic") return json({ error: "Automatic transfers are not switched on for this shop." }, 409);
        const base = MONNIFY_BASE[c.status];

        try {
          const { result, token: bearer } = await monnifyLogin(c.status, c.api_key, c.secret_key);
          if (result === "rejected") {
            await raiseKeysAlert(admin, business_id);
            return json({ error: "Monnify did not accept this shop's keys. The owner has been alerted and should reconnect on the Payments screen." }, 502);
          }
          if (result !== "ok" || !bearer) return json({ error: "Could not reach Monnify. Try again, or cancel the order." }, 502);
          const auth = { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" };

          const { data: biz } = await admin.from("businesses").select("name").eq("id", business_id).maybeSingle();
          // Step 1 (field names unconfirmed until the first sandbox test): start the transaction for this order.
          const init = await fetch(`${base}/api/v1/merchant/transactions/init-transaction`, {
            method: "POST", headers: auth, signal: AbortSignal.timeout(10000),
            body: JSON.stringify({
              amount: Number(pr.amount_kobo) / 100, currencyCode: "NGN", paymentReference: pr.reference,
              paymentDescription: `${biz?.name ?? "Shop"} order`, customerName: biz?.name ?? "NairaPlate customer",
              customerEmail: "payments@nairaplate.com", contractCode: c.contract_code, paymentMethods: ["ACCOUNT_TRANSFER"],
            }),
          });
          const ij = (await init.json().catch(() => null)) as { responseBody?: { transactionReference?: string } } | null;
          const txRef = ij?.responseBody?.transactionReference;
          if (!init.ok || !txRef) return json({ error: "Monnify could not start this payment." }, 502);
          // Step 2: ask for the one-time bank account for it.
          const pay = await fetch(`${base}/api/v1/merchant/bank-transfer/init-payment`, {
            method: "POST", headers: auth, signal: AbortSignal.timeout(10000), body: JSON.stringify({ transactionReference: txRef }),
          });
          const account = parseTransferAccount(await pay.json().catch(() => null));
          if (!pay.ok || !account) return json({ error: "Monnify did not give an account number for this order." }, 502);
          await admin.rpc("attach_payment_account", {
            p_request_id: pr.id, p_account_number: account.account_number, p_bank_name: account.bank_name, p_account_name: account.account_name, p_expires_at: account.expires_at,
          });
          return json({ ...account, reference: pr.reference });
        } catch {
          return json({ error: "Could not reach Monnify. Try again, or cancel the order." }, 502);
        }
      },
    },
  },
});
