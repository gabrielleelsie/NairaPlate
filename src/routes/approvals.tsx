import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/approvals")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Business approvals — NairaPlate" },
      { name: "description", content: "Review new business signups and approve or reject them." },
      { property: "og:title", content: "Business approvals — NairaPlate" },
      { property: "og:description", content: "Review new business signups." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Approvals,
});

type Row = { business_id: string; business_name: string; status: string; rejection_reason: string | null; created_at: string;
  owner_name: string | null; owner_phone: string | null; owner_email: string | null };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

function Approvals() {
  const { session, loading } = useStaffSession();
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pins, setPins] = useState({ current: "", next: "" });

  const load = useCallback(async () => {
    setErr(null);
    const { data, error } = await supabase.rpc("list_businesses_for_review", { p_status: tab });
    if (error) return setErr("Could not load businesses: " + error.message);
    setRows((data ?? []) as Row[]);
  }, [tab]);
  useEffect(() => { if (session?.role === "platform_admin") load(); }, [session, load]);

  async function review(r: Row, status: "approved" | "rejected") {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.from("businesses")
      .update({ status, rejection_reason: status === "rejected" ? reason.trim() || null : null })
      .eq("id", r.business_id).eq("status", "pending").select("id");
    setBusy(false);
    if (error) return setMsg("Not saved: " + error.message);
    if (!data?.length) return setMsg("Not saved — this business may already have been reviewed.");
    setMsg(`${r.business_name} ${status === "approved" ? "approved. They can sign in now." : "rejected."}`);
    setRejecting(null); setReason(""); load();
  }

  async function changePin() {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch("/api/public/staff-admin", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
      body: JSON.stringify({ action: "change_own_pin", current_pin: pins.current, new_pin: pins.next }) });
    const d = await res.json().catch(() => ({}));
    setMsg(d.ok ? "Your PIN has been changed." : d.error ?? "Could not change PIN.");
    if (d.ok) setPins({ current: "", next: "" });
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (session?.role !== "platform_admin")
    return <main className="p-6 space-y-2"><p>Platform admin only.</p><Link className="underline" to="/">Home</Link></main>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Business approvals</h1>
        <Link className="text-sm underline" to="/">Home</Link>
      </div>
      <div className="flex gap-2">
        {(["pending", "approved", "rejected"] as const).map((t) => (
          <Button key={t} variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t === "pending" ? "Waiting" : t === "approved" ? "Approved" : "Rejected"}
          </Button>
        ))}
      </div>
      {msg && <p className="text-sm text-foreground">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {rows.length === 0 && !err && <p className="text-muted-foreground">Nothing here.</p>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.business_id} className="space-y-2 rounded-lg border border-border bg-card p-4">
            <div className="font-medium text-card-foreground">{r.business_name} <span className="text-sm text-muted-foreground">({r.business_id})</span></div>
            <div className="text-sm text-muted-foreground">
              Owner: {r.owner_name ?? "—"} · {r.owner_phone ?? r.owner_email ?? "no contact"} · signed up {fmt(r.created_at)}
            </div>
            {r.rejection_reason && <div className="text-sm text-muted-foreground">Reason: {r.rejection_reason}</div>}
            {r.status === "pending" && (rejecting === r.business_id ? (
              <div className="space-y-2">
                <Label htmlFor={`why-${r.business_id}`}>Reason (optional)</Label>
                <Input id={`why-${r.business_id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="destructive" disabled={busy} onClick={() => review(r, "rejected")}>Confirm reject</Button>
                  <Button variant="outline" onClick={() => { setRejecting(null); setReason(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => review(r, "approved")}>Approve</Button>
                <Button variant="outline" disabled={busy} onClick={() => setRejecting(r.business_id)}>Reject</Button>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="font-medium text-foreground">Change my PIN</h2>
        <div className="grid grid-cols-2 gap-3">
          <Input type="password" inputMode="numeric" placeholder="Current PIN" value={pins.current} onChange={(e) => setPins({ ...pins, current: e.target.value.replace(/\D/g, "") })} />
          <Input type="password" inputMode="numeric" placeholder="New PIN (4–8 digits)" value={pins.next} onChange={(e) => setPins({ ...pins, next: e.target.value.replace(/\D/g, "") })} />
        </div>
        <Button variant="outline" disabled={pins.current.length < 4 || pins.next.length < 4} onClick={changePin}>Change PIN</Button>
      </section>
    </main>
  );
}
