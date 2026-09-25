import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/flags")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Alerts — NairaPlate" },
      { name: "description", content: "Drawer shortages and margin warnings that need attention." },
      { property: "og:title", content: "Alerts — NairaPlate" },
      { property: "og:description", content: "Drawer shortages and margin warnings that need attention." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Flags,
});

type Flag = { id: string; flag_type: string; severity: string | null; message: string | null; role: string | null; created_at: string };
const OWNER_ROLES = new Set(["owner", "supa_admin"]);

function Flags() {
  const { loading, session } = useStaffSession();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    let q = supabase.from("margin_flags").select("id,flag_type,severity,message,role,created_at")
      .eq("business_id", session.businessId).eq("acknowledged", false).order("created_at", { ascending: false });
    // Only flags addressed to this person's role; a Supa Admin sees every flag.
    if (session.role !== "supa_admin") q = q.eq("role", session.role);
    const { data, error } = await q;
    if (error) return setErr(error.message);
    setFlags(data ?? []);
  }, [session]);
  useEffect(() => { load(); }, [load]);

  async function ack(id: string) {
    const { error } = await supabase.from("margin_flags").update({ acknowledged: true }).eq("id", id);
    if (error) return setErr(error.message);
    load();
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !OWNER_ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Owners only.</p><Link className="underline" to="/">Back</Link></main>;

  return (
    <main className="mx-auto max-w-2xl p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Alerts</h1>
        <div className="flex gap-3"><Link className="underline" to="/dashboard">Profit & loss</Link><Link className="underline" to="/">Home</Link></div>
      </div>
      {err && <p className="text-destructive">{err}</p>}
      {flags?.length === 0 && <p>Nothing needs your attention.</p>}
      {flags?.map((f) => (
        <div key={f.id} className={`rounded-lg border p-3 flex justify-between gap-3 ${f.severity === "critical" ? "border-destructive" : ""}`}>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{f.flag_type.replace(/_/g, " ")} · {f.severity ?? "info"} · {new Date(f.created_at).toLocaleString()}</p>
            <p>{f.message}</p>
          </div>
          <Button variant="outline" onClick={() => ack(f.id)}>Mark as seen</Button>
        </div>
      ))}
    </main>
  );
}
