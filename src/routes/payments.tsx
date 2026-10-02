import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { FEE_CONFIRM, FEE_NOTICE, FEE_NOTICE_TITLE, PAYMENT_MODE_LABEL, type PaymentMode } from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/payments")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Payments and transfers — NairaPlate" },
      { name: "description", content: "Connect your payment provider so bank transfers at the till are confirmed automatically." },
      { property: "og:title", content: "Payments and transfers — NairaPlate" },
      { property: "og:description", content: "Connect your payment provider so bank transfers at the till are confirmed automatically." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentsScreen,
});

const OWNER_ROLES = new Set(["owner", "supa_admin"]);
type Settings = { mode: PaymentMode; provider: string | null; provider_status: "not_connected" | "test" | "live"; connected_at: string | null };
const MODE_HELP: Record<PaymentMode, string> = {
  manual: "Staff type in a transfer amount at the till. NairaPlate cannot check it. This is how it works today.",
  cash_only: "The till takes cash and customer credit only. Transfers are switched off.",
  automatic: "Transfers are taken only through the bank link. The order turns Paid by itself when the money arrives, and nobody can mark it paid by hand.",
};

function PaymentsScreen() {
  const { loading, session } = useStaffSession();
  const [s, setS] = useState<Settings | null>(null);
  const [status, setStatus] = useState<"test" | "live">("test");
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [contract, setContract] = useState("");
  const [busy, setBusy] = useState(false);
  const [keysAlert, setKeysAlert] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("business_payment_settings").select("mode,provider,provider_status,connected_at").maybeSingle();
    setS((data as Settings | null) ?? { mode: "manual", provider: null, provider_status: "not_connected", connected_at: null });
    const { data: flags } = await supabase.from("margin_flags").select("id").eq("flag_type", "payment_keys").eq("acknowledged", false).limit(1);
    setKeysAlert((flags ?? []).length > 0);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !OWNER_ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Owners only.</p><Link className="underline" to="/app">Back</Link></main>;

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/public/payment-connect", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      body: JSON.stringify({ provider: "monnify", status, api_key: apiKey, secret_key: secretKey, contract_code: contract }),
    }).catch(() => null);
    setBusy(false);
    const j = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    if (!res || !res.ok) return setMsg({ ok: false, text: j.error ?? "Could not reach the server." });
    setApiKey(""); setSecretKey("");
    setMsg({ ok: true, text: `Monnify connected in ${status} mode. Now add the webhook address below on your Monnify dashboard, then switch automatic transfers on.` });
    void load();
  }

  async function testConnection() {
    setTesting(true); setTestMsg(null);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/public/payment-test", { method: "POST", headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` } }).catch(() => null);
    setTesting(false);
    const j = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; status?: string }) : {};
    if (!res || (!res.ok && !j.error)) return setTestMsg({ ok: false, text: "Could not reach the server." });
    if (j.ok) setTestMsg({ ok: true, text: `Monnify accepted the saved keys (${j.status} mode). Transfers can get an account number.` });
    else setTestMsg({ ok: false, text: j.error ?? "The check failed." });
    void load();
  }

  async function changeMode(m: PaymentMode) {
    if (m === "automatic" && !confirm(FEE_CONFIRM)) return;
    if (m === "cash_only" && !confirm("Switch to cash and credit only? Transfers will be switched off at the till.")) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("set_payment_mode" as never, { p_mode: m } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: `Saved: ${PAYMENT_MODE_LABEL[m]}.` });
    void load();
  }

  const connected = s?.provider_status === "test" || s?.provider_status === "live";
  const webhook = typeof window === "undefined" ? "" : `${window.location.origin}/api/public/payment-webhook`;
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Payments and transfers</h1><Link className="underline" to="/app">Home</Link></div>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
      {keysAlert && (
        <p className="rounded-md border border-destructive p-3 text-sm text-destructive" data-testid="keys-alert">
          Monnify has stopped accepting this shop's keys, so customers cannot be given an account number for a transfer. Press <b>Test connection</b> below, or connect again with current keys.
        </p>
      )}
      <p className="rounded-md bg-muted p-3 text-sm">New to this? Follow the <Link className="font-medium underline" to="/payments-guide">step-by-step Monnify setup guide</Link>. It takes about 20 minutes and you test with no real money first.</p>

      <section className="space-y-1 rounded-lg border border-border bg-muted p-4" data-testid="fee-notice">
        <h2 className="text-lg font-semibold">{FEE_NOTICE_TITLE}</h2>
        <p className="text-sm">{FEE_NOTICE}</p>
      </section>

      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">How transfers are taken at your till</h2>
        {s === null ? <p className="text-sm text-muted-foreground">Loading…</p> : (["manual", "cash_only", "automatic"] as PaymentMode[]).map((m) => (
          <label key={m} className={`flex gap-2 rounded-md border p-2 ${s.mode === m ? "border-primary" : "border-border"} ${m === "automatic" && !connected ? "opacity-50" : ""}`}>
            <input type="radio" name="mode" checked={s.mode === m} disabled={busy || (m === "automatic" && !connected)} onChange={() => void changeMode(m)} />
            <span><span className="font-medium">{PAYMENT_MODE_LABEL[m]}</span><br /><span className="text-sm text-muted-foreground">{MODE_HELP[m]}</span></span>
          </label>
        ))}
        {!connected && <p className="text-xs text-muted-foreground">Automatic transfers need a connected payment provider. Connect one below first.</p>}
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">Payment provider: Monnify <Link className="ml-2 text-sm font-normal underline" to="/payments-guide">Setup guide</Link></h2>
        <p className="text-sm text-muted-foreground">
          {connected ? `Connected in ${s?.provider_status} mode. Enter new keys below to replace them, or press Test connection to check the saved ones.` : "Not connected. You need a Monnify account (it is Moniepoint's payment service for businesses). Start in test mode: no real money moves."}
        </p>
        {connected && (
          <div className="space-y-1">
            <Button type="button" variant="outline" disabled={testing} onClick={() => void testConnection()}>{testing ? "Testing…" : "Test connection"}</Button>
            {testMsg && <p className={`text-sm ${testMsg.ok ? "text-primary" : "text-destructive"}`} data-testid="test-result">{testMsg.text}</p>}
          </div>
        )}
        <form onSubmit={connect} className="grid gap-3">
          <div className="grid gap-1"><Label htmlFor="pv-status">Mode</Label>
            <select id="pv-status" className="h-10 rounded-md border border-input bg-background px-3" value={status} onChange={(e) => setStatus(e.target.value as "test" | "live")}>
              <option value="test">Test (no real money)</option><option value="live">Live (real money)</option>
            </select></div>
          <div className="grid gap-1"><Label htmlFor="pv-api">API key</Label><Input id="pv-api" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="pv-secret">Secret key</Label><Input id="pv-secret" type="password" autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="pv-contract">Contract code</Label><Input id="pv-contract" autoComplete="off" value={contract} onChange={(e) => setContract(e.target.value)} /></div>
          <Button type="submit" disabled={busy || !apiKey.trim() || !secretKey.trim() || !contract.trim()}>{busy ? "Checking…" : "Check and connect"}</Button>
          <p className="text-xs text-muted-foreground">The keys are checked with Monnify, then stored encrypted. They are never shown again, and staff cannot see them. Use test keys with Test mode and live keys with Live mode.</p>
        </form>
      </section>

      <section className="space-y-1 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">Webhook address</h2>
        <p className="text-sm text-muted-foreground">On your Monnify dashboard, set the transaction notification (webhook) address to this, so Monnify can tell NairaPlate when money arrives:</p>
        <p className="break-all rounded bg-muted p-2 text-sm font-mono" data-testid="webhook-url">{webhook}</p>
      </section>
    </main>
  );
}
