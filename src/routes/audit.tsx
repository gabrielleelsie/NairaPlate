import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { dayRangeIso } from "@/lib/payouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/audit")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Audit log — NairaPlate" },
      { name: "description", content: "Who did what and when: sign-ins, staff changes, price changes, refunds and cash drawer differences." },
      { property: "og:title", content: "Audit log — NairaPlate" },
      { property: "og:description", content: "Who did what and when across your business." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditScreen,
});

const ROLES = new Set(["owner", "supa_admin"]);
export const AUDIT_ACTIONS: Record<string, string> = {
  login_success: "Signed in",
  login_failed: "Wrong PIN",
  account_locked: "Account locked",
  staff_created: "Staff added",
  role_changed: "Role changed",
  staff_deactivated: "Staff deactivated",
  pin_reset: "PIN reset",
  cost_changed: "Ingredient cost changed",
  price_published: "Dish price published",
  order_adjusted: "Order voided / refunded",
  drawer_discrepancy: "Cash drawer difference",
  business_created: "Business signed up",
  business_approved: "Business approved",
  business_rejected: "Business rejected",
};

type Row = { id: string; actor_id: string | null; actor_role: string | null; action: string; details: string | null; created_at: string };

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function AuditScreen() {
  const { loading, session } = useStaffSession();
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setErr(null);
    const { startIso, endIso } = dayRangeIso(from, to);
    let q = supabase.from("audit_logs").select("id,actor_id,actor_role,action,details,created_at")
      .eq("business_id", session.businessId).gte("created_at", startIso).lt("created_at", endIso)
      .order("created_at", { ascending: false }).limit(500);
    if (action) q = q.eq("action", action);
    const [logs, staff] = await Promise.all([
      q, supabase.from("staff_users").select("id,display_name").eq("business_id", session.businessId),
    ]);
    if (logs.error) return setErr("Could not load the audit log.");
    setRows(logs.data ?? []);
    setNames(Object.fromEntries((staff.data ?? []).map((s) => [s.id, s.display_name])));
  }, [session, from, to, action]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/" className="underline text-sm">Go to sign-in</Link></Shell>;
  if (!ROLES.has(session.role)) return <Shell><p className="text-muted-foreground">Only owners can see the audit log.</p><Link to="/" className="underline text-sm">Home</Link></Shell>;

  return (
    <Shell>
      <Link to="/" className="text-sm text-muted-foreground underline">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every entry is permanent — nobody can change or delete it.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="to">To</Label><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <Label htmlFor="action">What happened</Label>
          <select id="action" value={action} onChange={(e) => setAction(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option value="">Everything</option>
            {Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <Button variant="outline" size="sm" className="mt-3" onClick={load}>Refresh</Button>

      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {rows.length === 0 && !err && <li className="p-4 text-sm text-muted-foreground">Nothing logged for these dates.</li>}
        {rows.map((r) => (
          <li key={r.id} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium text-foreground">{AUDIT_ACTIONS[r.action] ?? r.action}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Africa/Lagos" })}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {r.actor_id ? (names[r.actor_id] ?? "Unknown staff") : "System"}{r.actor_role ? ` (${r.actor_role})` : ""}
            </div>
            {r.details && <div className="mt-1 text-foreground">{r.details}</div>}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-3xl bg-background p-6">{children}</main>;
}
