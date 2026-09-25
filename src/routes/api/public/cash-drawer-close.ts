// cash-drawer-close — closes the caller's open cash drawer and raises a variance flag.
// Runs on the server because margin_flags can only be written by owners under the access
// rules, but a cashier's short/over drawer must still raise a flag for the owner.
// The caller's business, role and user id come ONLY from the verified login token.
import { createFileRoute } from "@tanstack/react-router";
import { writeAudit } from "@/lib/audit.server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const DRAWER_ROLES = new Set(["cashier", "owner", "supa_admin"]);
const Body = z.object({ closing_counted_kobo: z.number().int().min(0).max(1e13) });

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const naira = (k: number) =>
  `₦${(Math.abs(k) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const Route = createFileRoute("/api/public/cash-drawer-close")({
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
        if (!business_id || !DRAWER_ROLES.has(role)) return json({ error: "Only cashiers and owners use the drawer." }, 403);

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Enter the counted cash amount." }, 400);
        const counted = parsed.data.closing_counted_kobo;

        // This caller's open drawer in this business.
        const { data: drawer } = await admin.from("cash_drawers").select("*")
          .eq("business_id", business_id).eq("opened_by", u.user.id).eq("status", "open")
          .order("opened_at", { ascending: false }).limit(1).maybeSingle();
        if (!drawer) return json({ error: "You have no open shift." }, 404);

        const closedAt = new Date().toISOString();
        // Expected cash = float + cash portion of every PAID (or part-refunded) cash/split order
        // since the shift opened. Voided ('cancelled') and fully 'refunded' orders add nothing.
        // A partial refund comes out of the cash portion (never more than the cash taken).
        const { data: orders, error: oe } = await admin.from("orders")
          .select("id,cash_amount_kobo")
          .eq("business_id", business_id).in("payment_method", ["cash", "split"])
          .in("status", ["paid", "partially_refunded"])
          .gte("created_at", drawer.opened_at).lte("created_at", closedAt);
        if (oe) return json({ error: "Could not read orders." }, 500);
        const ids = (orders ?? []).map((o) => o.id);
        const { data: partials, error: pe } = ids.length
          ? await admin.from("order_adjustments").select("order_id,adjustment_amount_kobo")
              .eq("type", "partial_refund").in("order_id", ids)
          : { data: [], error: null };
        const refunded = new Map<string, number>();
        for (const a of pe ? [] : partials ?? []) {
          refunded.set(a.order_id, (refunded.get(a.order_id) ?? 0) + Number(a.adjustment_amount_kobo));
        }
        const cashSales = (orders ?? []).reduce(
          (s, o) => s + Math.max(0, Number(o.cash_amount_kobo) - (refunded.get(o.id) ?? 0)), 0);
        const expected = Number(drawer.opening_float_kobo) + cashSales;
        const discrepancy = counted - expected;

        const { error: de } = await admin.from("cash_drawers").update({
          closing_counted_kobo: counted, expected_cash_kobo: expected, discrepancy_kobo: discrepancy,
          status: "closed", closed_at: closedAt,
        }).eq("id", drawer.id).eq("status", "open");
        if (de) return json({ error: "Could not close the shift." }, 500);

        let flag = null;
        if (discrepancy !== 0) {
          const name = String(u.user.user_metadata?.["display_name"] ?? "Unknown staff");
          const kind = discrepancy < 0 ? "short" : "over";
          const { data: f } = await admin.from("margin_flags").insert({
            business_id, flag_type: "drawer_variance",
            severity: Math.abs(discrepancy) < 100000 ? "warn" : "critical",
            message: `Cash drawer was ${kind} by ${naira(discrepancy)} on ${name}'s shift.`,
            role: "owner", acknowledged: false,
          }).select("*").single();
          flag = f;
          await writeAudit(admin, { business_id, actor_id: u.user.id, actor_role: role, action: "drawer_discrepancy",
            entity_type: "cash_drawers", entity_id: drawer.id,
            details: `${name}: ${kind} by ${naira(discrepancy)} (expected ${naira(expected)}, counted ${naira(counted)})` });
        }
        return json({
          opening_float_kobo: Number(drawer.opening_float_kobo), cash_sales_kobo: cashSales,
          expected_cash_kobo: expected, closing_counted_kobo: counted, discrepancy_kobo: discrepancy, flag,
        });
      },
    },
  },
});
