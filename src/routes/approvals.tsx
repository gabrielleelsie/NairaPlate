// Platform support console. Platform admin only.
// Tier 1 actions (approve, reject, reactivate, unlock a staff PIN) need only a valid session.
// Tier 2 actions (suspend a business, emergency owner PIN reset) also ask for the admin's
// own PIN, because a stolen session must never be enough to shut down or take over a kitchen.
import { PlatformSettingsPanel } from "@/components/PlatformSettingsPanel";
import { OPERATING_MODES, OVERRIDABLE, asMode, hasFeature, type OperatingMode } from "@/lib/features";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { PLAN_NAME, planPriceInput, type Prices } from "@/lib/platform-settings";
import { accessState, formatLagosDate, PLAN_LABEL } from "@/lib/subscription";
import { lagosDateKey } from "@/lib/lagos-time";
import { Activity, AlertTriangle, Building2, Download, KeyRound, LogOut, RefreshCw, Search, ShieldAlert, Unlock, Users } from "lucide-react";

export const Route = createFileRoute("/approvals")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Platform console — NairaPlate" },
      { name: "description", content: "Review signups, manage business accounts and troubleshoot staff sign-in problems." },
      { property: "og:title", content: "Platform console — NairaPlate" },
      { property: "og:description", content: "Review signups, manage business accounts and troubleshoot sign-in problems." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlatformConsole,
});

type Biz = {
  business_id: string; business_name: string; status: string; reason: string | null;
  created_at: string; reviewed_at: string | null;
  owner_name: string | null; owner_contact: string | null;
  active_staff: number; locked_staff: number;
  plan: string | null; trial_started_at: string | null; access_ends_at: string | null; has_access: boolean;
  payment_mode?: string; payment_provider?: string | null; payment_status?: string;
};
type Payment = {
  id: string; plan: string; amount_kobo: number; payment_reference: string; paid_on: string;
  period_start: string; period_end: string; recorded_by_name: string; created_at: string;
};
type StaffRow = {
  id: string; display_name: string; role: string; is_active: boolean;
  failed_attempts: number; locked: boolean; locked_seconds: number; contact: string | null;
};
type AuditRow = { id: string; action: string; actor_role: string | null; details: string | null; created_at: string };
type FlagRow = { id: string; flag_type: string; severity: string | null; message: string | null; created_at: string };
type Detail = {
  business: { id: string; name: string; status: string; reason: string | null; plan: string | null; access_ends_at: string | null; has_access: boolean };
  payments: Payment[];
  staff: StaffRow[]; audit: AuditRow[]; flags: FlagRow[];
  features?: { catering: boolean };
  overrides?: Record<string, boolean>;
  operating_mode?: string | null;
};

const ENDPOINT = "/api/public/platform-admin";
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
const roleLabel = (r: string) => ({ owner: "Owner", supa_admin: "Supa Admin", cashier: "Cashier", purchaser: "Purchaser", cook: "Kitchen Staff" }[r] ?? r.replaceAll("_", " "));

async function callApi(body: unknown) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  suspended: "bg-red-100 text-red-800",
  rejected: "bg-slate-200 text-slate-700",
};
const STATUS_WORD: Record<string, string> = { approved: "Active", pending: "Waiting", suspended: "Suspended", rejected: "Rejected" };

function Badge({ status }: { status: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] ?? "bg-slate-200 text-slate-700"}`}>{STATUS_WORD[status] ?? status}</span>;
}

/** Plan and access end date, e.g. "Free trial · 3 days left" or "Plan ended 2 Oct 2026". */
function PlanBadge({ status, plan, access_ends_at }: { status: string; plan: string | null; access_ends_at: string | null }) {
  if (status !== "approved" && status !== "suspended") return null;
  const st = accessState({ status: "approved", access_ends_at, plan });
  if (st.kind === "active") {
    const soon = st.daysLeft <= 3;
    return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${soon ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}>
      {PLAN_LABEL[plan ?? ""] ?? "Plan"} · {st.daysLeft === 1 ? "ends today" : `${st.daysLeft} days left`} (to {formatLagosDate(st.endsAt)})
    </span>;
  }
  return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
    {access_ends_at ? `Plan ended ${formatLagosDate(access_ends_at)}` : "No plan"}
  </span>;
}
const isExpired = (b: Biz) => b.status === "approved" && !b.has_access;
const endsSoon = (b: Biz) => { const st = accessState(b); return st.kind === "active" && st.daysLeft <= 3; };

type Tab = "health" | "queue" | "directory" | "diagnostics" | "audit" | "messages" | "settings" | "security";

type Watch = { business_id: string; business_name: string; locked: number; flags: number; reasons: string[] };
type Health = {
  generated_at: string; latency_ms: number;
  tenants: { total: number; approved: number; pending: number; suspended: number; rejected: number; on_trial?: number; active_paid?: number; expired?: number };
  people: { active_staff: number; locked_now: number; failed_logins_24h: number; successful_logins_24h: number; lockouts_24h: number };
  activity: { orders_today: number; gmv_today_kobo: number; gmv_week_kobo: number; events_24h: number };
  flags: { open_total: number; critical: number };
  watchlist: Watch[];
  recent_ops: { id: string; business_id: string; business_name: string; action: string; actor_role: string | null; details: string | null; created_at: string }[];
};
type AuditEvent = {
  id: string; business_id: string; business_name: string; action: string;
  actor_role: string | null; actor_name: string; entity_type: string | null;
  details: string | null; created_at: string;
};

const naira = (kobo: number) => "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });
// Plain-English names for events whose raw action name would not read well.
const ACTION_LABEL: Record<string, string> = {
  email_undelivered: "Email not delivered",
  subscription_payment_recorded: "Subscription payment recorded",
  security_alert_undelivered: "Security alert not delivered",
  platform_setting_changed: "Platform setting changed",
  feature_switched: "Feature switched",
};
const words = (s: string) =>
  ACTION_LABEL[s] ?? s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

function PlatformConsole() {
  const { session, loading } = useStaffSession();
  const [tab, setTab] = useState<Tab>("health");
  const [all, setAll] = useState<Biz[]>([]);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [auditBiz, setAuditBiz] = useState<string>("");
  const [unhandled, setUnhandled] = useState(0);

  const load = useCallback(async () => {
    setErr(null);
    const [{ status, data }, m] = await Promise.all([
      callApi({ action: "list_businesses" }),
      callApi({ action: "list_messages", handled: false }),
    ]);
    if (m.status === 200) setUnhandled(Number(m.data["unhandled"] ?? 0));
    if (status !== 200) return setErr(String(data["error"] ?? "Could not load businesses."));
    setAll((data["businesses"] ?? []) as Biz[]);
  }, []);

  const openDetail = useCallback(async (business_id: string) => {
    setDetail(null); setTab("diagnostics"); setMsg(null); setErr(null);
    if (!business_id) return setFocus(null); // "back to all businesses"
    setFocus(business_id);
    const { status, data } = await callApi({ action: "business_detail", business_id });
    if (status !== 200) return setErr(String(data["error"] ?? "Could not load that business."));
    setDetail(data as unknown as Detail);
  }, []);

  useEffect(() => { if (session?.role === "platform_admin") load(); }, [session, load]);

  async function act(body: Record<string, unknown>, okText: (d: Record<string, unknown>) => string) {
    setBusy(true); setMsg(null); setErr(null);
    const { status, data } = await callApi(body);
    setBusy(false);
    if (status !== 200) { setErr(String(data["error"] ?? "That didn't work.")); return null; }
    setMsg(okText(data) + (data["still_expired"] ? ` ${String(data["message"] ?? "")}` : ""));
    await load();
    if (focus) {
      const { data: d2 } = await callApi({ action: "business_detail", business_id: focus });
      setDetail(d2 as unknown as Detail);
    }
    return data;
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (session?.role !== "platform_admin")
    return <main className="space-y-2 p-6"><p>Platform admin only.</p><Link className="underline" to="/app">Home</Link></main>;

  const pending = all.filter((b) => b.status === "pending");
  const q = search.trim().toLowerCase();
  const directory = q
    ? all.filter((b) => [b.business_id, b.business_name, b.owner_name ?? "", b.owner_contact ?? ""].join(" ").toLowerCase().includes(q))
    : all;
  const lockedTotal = all.reduce((n, b) => n + b.locked_staff, 0);

  const TABS: { key: Tab; label: string; count?: number | undefined }[] = [
    { key: "health", label: "Health" },
    { key: "queue", label: "Waiting", count: pending.length },
    { key: "directory", label: "Businesses", count: all.length },
    { key: "diagnostics", label: "Troubleshoot", count: lockedTotal },
    { key: "audit", label: "Audit trail" },
    { key: "messages", label: "Messages", count: unhandled },
    { key: "settings", label: "Settings" },
    { key: "security", label: "My account" },
  ];

  return (
    <main className="min-h-dvh bg-home-surface">
      <header className="bg-brand-navy text-brand-inverse">
        <div className="mx-auto grid min-h-20 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-5 px-4 sm:gap-8 sm:px-6">
          <Logo variant="white" layout="inline" size={38} className="min-w-0" />
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 truncate text-right text-sm font-semibold">
              {session.name} <span className="font-normal text-brand-inverse/60">·</span> Platform Admin
            </div>
            <Button asChild variant="ghost" size="icon" className="shrink-0 text-brand-inverse hover:bg-brand-inverse/10 hover:text-brand-inverse" title="Home" aria-label="Home">
              <Link to="/app"><LogOut /></Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Button key={t.key} variant={tab === t.key ? "default" : "outline"} onClick={() => { setTab(t.key); setMsg(null); setErr(null); }}
              className={tab === t.key ? "bg-brand-blue text-brand-inverse hover:bg-brand-blue/90" : ""}>
              {t.label}{t.count ? ` (${t.count})` : ""}
            </Button>
          ))}
        </div>

        {msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
        {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{err}</p>}

        {tab === "health" && <HealthBoard onInspect={openDetail} onAudit={(id) => { setAuditBiz(id); setTab("audit"); }} />}
        {tab === "queue" && <Queue rows={pending} busy={busy} act={act} />}
        {tab === "directory" && (
          <Directory rows={directory} search={search} setSearch={setSearch} busy={busy} act={act} onInspect={openDetail} />
        )}
        {tab === "diagnostics" && (
          <Diagnostics all={all} focus={focus} detail={detail} busy={busy} act={act} onPick={openDetail} />
        )}
        {tab === "audit" && <AuditInspector businesses={all} initialBusiness={auditBiz} />}
        {tab === "messages" && <Messages onCount={setUnhandled} />}
        {tab === "settings" && <PlatformSettingsPanel callApi={callApi} />}
        {tab === "security" && <MyAccount />}
      </div>
    </main>
  );
}

type Act = (body: Record<string, unknown>, ok: (d: Record<string, unknown>) => string) => Promise<Record<string, unknown> | null>;

function Queue({ rows, busy, act }: { rows: Biz[]; busy: boolean; act: Act }) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (rows.length === 0) return <p className="text-muted-foreground">No new businesses are waiting.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.business_id} className="space-y-2 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-card-foreground">{r.business_name}</span>
            <span className="text-sm text-muted-foreground">({r.business_id})</span>
            <Badge status={r.status} />
          </div>
          <div className="text-sm text-muted-foreground">
            Owner: {r.owner_name ?? "—"} · {r.owner_contact ?? "no contact"} · signed up {fmt(r.created_at)}
          </div>
          {rejecting === r.business_id ? (
            <div className="space-y-2">
              <Label htmlFor={`why-${r.business_id}`}>Reason (optional)</Label>
              <Input id={`why-${r.business_id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="destructive" disabled={busy} onClick={async () => {
                  await act({ action: "set_status", business_id: r.business_id, status: "rejected", reason: reason.trim() || undefined },
                    () => `${r.business_name} rejected.`);
                  setRejecting(null); setReason("");
                }}>Confirm reject</Button>
                <Button variant="outline" onClick={() => { setRejecting(null); setReason(""); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button disabled={busy} className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90"
                onClick={() => act({ action: "set_status", business_id: r.business_id, status: "approved" }, () => `${r.business_name} approved. They can sign in now.`)}>
                Approve
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setRejecting(r.business_id)}>Reject</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Directory({ rows, search, setSearch, busy, act, onInspect }: {
  rows: Biz[]; search: string; setSearch: (v: string) => void; busy: boolean; act: Act; onInspect: (id: string) => void;
}) {
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [filter, setFilter] = useState<"all" | "expired" | "soon">("all");
  const shown = filter === "expired" ? rows.filter(isExpired) : filter === "soon" ? rows.filter(endsSoon) : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([["all", `All (${rows.length})`], ["expired", `Expired (${rows.filter(isExpired).length})`], ["soon", `Ending within 3 days (${rows.filter(endsSoon).length})`]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{label}</Button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by business code, name, owner or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {shown.length === 0 && <p className="text-muted-foreground">No business matches that.</p>}
      <ul className="space-y-3">
        {shown.map((r) => (
          <li key={r.business_id} className={`space-y-3 rounded-xl border p-4 ${isExpired(r) ? "border-red-300 bg-red-50/50" : "border-border bg-card"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-card-foreground">{r.business_name}</span>
              <span className="text-sm text-muted-foreground">({r.business_id})</span>
              <Badge status={r.status} />
              <PlanBadge status={r.status} plan={r.plan} access_ends_at={r.access_ends_at} />
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground" title="How this shop takes transfers">
                {r.payment_mode === "automatic" ? `Transfers: automatic (${r.payment_provider ?? "?"}, ${r.payment_status})` : r.payment_mode === "cash_only" ? "Transfers: off (cash only)" : r.payment_status && r.payment_status !== "not_connected" ? `Provider connected (${r.payment_status}), transfers not automatic` : "Transfers: typed in (not connected)"}
              </span>
              {r.locked_staff > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                  <AlertTriangle className="size-3" />{r.locked_staff} locked out
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              Owner: {r.owner_name ?? "—"} · {r.owner_contact ?? "no contact"} · {r.active_staff} active staff · joined {fmt(r.created_at)}
            </div>
            {r.reason && <div className="text-sm text-muted-foreground">Reason on file: {r.reason}</div>}

            {suspending === r.business_id ? (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-destructive"><ShieldAlert className="size-4" />Suspending locks every staff member out immediately.</p>
                <Label htmlFor={`sr-${r.business_id}`}>Why are you suspending this business? (kept on the record)</Label>
                <Input id={`sr-${r.business_id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. unpaid subscription, reported misuse" />
                <Label htmlFor={`sp-${r.business_id}`}>Your own PIN</Label>
                <Input id={`sp-${r.business_id}`} type="password" inputMode="numeric" value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Confirm with your PIN" />
                <div className="flex gap-2">
                  <Button variant="destructive" disabled={busy || reason.trim().length < 5 || pin.length < 4} onClick={async () => {
                    const ok = await act({ action: "suspend_business", business_id: r.business_id, reason: reason.trim(), admin_pin: pin },
                      () => `${r.business_name} is suspended. Nobody there can sign in.`);
                    setPin("");
                    if (ok) { setSuspending(null); setReason(""); }
                  }}>Confirm suspend</Button>
                  <Button variant="outline" onClick={() => { setSuspending(null); setReason(""); setPin(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onInspect(r.business_id)}>Inspect</Button>
                {(r.status === "approved" || r.status === "suspended") && (
                  <Button variant="outline" size="sm" onClick={() => onInspect(r.business_id)}>Record payment</Button>
                )}
                {r.status === "pending" && (
                  <Button size="sm" disabled={busy} className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90"
                    onClick={() => act({ action: "set_status", business_id: r.business_id, status: "approved" }, () => `${r.business_name} approved.`)}>Approve</Button>
                )}
                {r.status === "approved" && (
                  <Button variant="outline" size="sm" className="border-red-300 text-destructive hover:bg-red-50"
                    onClick={() => { setSuspending(r.business_id); setReason(""); setPin(""); }}>Suspend</Button>
                )}
                {(r.status === "suspended" || r.status === "rejected") && (
                  <Button size="sm" disabled={busy} className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90"
                    onClick={() => act({ action: "set_status", business_id: r.business_id, status: "approved" },
                      () => `${r.business_name} is active again.`)}>Reactivate</Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Diagnostics({ all, focus, detail, busy, act, onPick }: {
  all: Biz[]; focus: string | null; detail: Detail | null; busy: boolean; act: Act; onPick: (id: string) => void;
}) {
  const [resetting, setResetting] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [issued, setIssued] = useState<{ name: string; pin: string } | null>(null);

  if (!focus) {
    const troubled = all.filter((b) => b.locked_staff > 0);
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Pick a business to look inside: staff sign-in problems, recent activity and open alerts.</p>
        {troubled.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 text-sm font-semibold text-amber-900">Staff locked out right now</p>
            <ul className="space-y-1">
              {troubled.map((b) => (
                <li key={b.business_id}>
                  <button className="text-sm underline" onClick={() => onPick(b.business_id)}>
                    {b.business_name} — {b.locked_staff} locked out
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {all.map((b) => (
            <li key={b.business_id}>
              <Button variant="outline" className="h-auto w-full justify-start whitespace-normal p-3 text-left" onClick={() => onPick(b.business_id)}>
                <span className="font-medium">{b.business_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{b.business_id}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!detail) return <p className="text-muted-foreground">Loading that business…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPick("")}>← All businesses</Button>
        <span className="font-semibold text-brand-navy">{detail.business.name}</span>
        <Badge status={detail.business.status} />
        <PlanBadge status={detail.business.status} plan={detail.business.plan} access_ends_at={detail.business.access_ends_at} />
      </div>

      {(detail.business.status === "approved" || detail.business.status === "suspended") && (
        <RecordPayment mode={detail.operating_mode == null ? null : asMode(detail.operating_mode)} businessId={detail.business.id} businessName={detail.business.name} suspended={detail.business.status === "suspended"} busy={busy} act={act} />
      )}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="features-panel">
        <h2 className="font-semibold text-card-foreground">Kitchen profile & tools</h2>
        {detail.operating_mode == null ? (
          <p className="text-sm text-muted-foreground">Kitchen profiles are not switched on in the database yet, so this kitchen sees every tool.</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Kitchen profile">
            {OPERATING_MODES.map((m) => (
              <Button key={m.value} size="sm" variant={detail.operating_mode === m.value ? "default" : "outline"} disabled={busy || detail.operating_mode === m.value}
                onClick={() => act({ action: "set_operating_mode", business_id: detail.business.id, mode: m.value }, () => `${detail.business.name} is now on ${m.label}.`)}>
                {m.label}
              </Button>
            ))}
          </div>
        )}
        <p className="text-sm text-muted-foreground">Buka shows only the basics. Each tool below follows the profile unless you switch it on or off for this kitchen. Catering is off unless switched on.</p>
        <ul className="space-y-2">
          {OVERRIDABLE.map(({ feature, label }) => {
            const mode = asMode(detail.operating_mode);
            const o = detail.overrides?.[feature];
            const on = hasFeature(mode, feature, detail.overrides);
            return (
              <li key={feature} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${on ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"}`}>{label}: {on ? "On" : "Off"}</span>
                <span className="text-xs text-muted-foreground">{o === undefined ? "from profile" : "set for this kitchen"}</span>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => act({ action: "set_feature", business_id: detail.business.id, feature, enabled: !on }, () => `${label} is now ${!on ? "on" : "off"} for ${detail.business.name}.`)}>
                  {on ? "Switch off" : "Switch on"}
                </Button>
                {o !== undefined && (
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => act({ action: "set_feature", business_id: detail.business.id, feature, enabled: null }, () => `${label} now follows the profile for ${detail.business.name}.`)}>
                    Use profile default
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold text-card-foreground">Payments history</h2>
        {(detail.payments ?? []).length === 0 && <p className="text-sm text-muted-foreground">No payments recorded yet.</p>}
        <ul className="space-y-1 text-sm">
          {(detail.payments ?? []).map((p) => (
            <li key={p.id} className="text-muted-foreground">
              <span className="text-foreground">{formatLagosDate(p.paid_on + "T12:00:00Z")}</span> · {PLAN_LABEL[p.plan] ?? p.plan} · {naira(Number(p.amount_kobo))} · ref {p.payment_reference}
              {" "}— covers {formatLagosDate(p.period_start)} to {formatLagosDate(p.period_end)} · recorded by {p.recorded_by_name}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold text-card-foreground">Staff and sign-in problems</h2>
        {detail.staff.length === 0 && <p className="text-sm text-muted-foreground">No staff on this account.</p>}
        <ul className="space-y-2">
          {detail.staff.map((s) => (
            <li key={s.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{s.display_name}</span>
                <span className="text-muted-foreground">{roleLabel(s.role)}</span>
                {!s.is_active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">Deactivated</span>}
                {s.locked && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Locked {s.locked_seconds}s</span>}
                {!s.locked && s.failed_attempts > 0 && <span className="text-xs text-amber-800">{s.failed_attempts} wrong PIN tries</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {(s.locked || s.failed_attempts > 0) && (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => act({ action: "unlock_staff", business_id: detail.business.id, staff_id: s.id },
                      (d) => `${String(d["display_name"])} can try their PIN again.`)}>
                    <Unlock className="size-4" />Clear lockout
                  </Button>
                )}
                {(s.role === "owner" || s.role === "supa_admin") && (
                  <Button size="sm" variant="outline" className="border-red-300 text-destructive hover:bg-red-50"
                    onClick={() => { setResetting(s.id); setPin(""); setIssued(null); }}>
                    <KeyRound className="size-4" />Emergency PIN reset
                  </Button>
                )}
              </div>
              {resetting === s.id && (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <ShieldAlert className="size-4" />This gives whoever you read it to full access to this business.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Only do this after you are sure who you are speaking to. It can be used once per business per day, it is recorded permanently, and an alert email goes out straight away.
                  </p>
                  <Label htmlFor={`rp-${s.id}`}>Your own PIN</Label>
                  <Input id={`rp-${s.id}`} type="password" inputMode="numeric" value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Confirm with your PIN" />
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" disabled={busy || pin.length < 4} onClick={async () => {
                      const d = await act({ action: "emergency_reset_owner_pin", business_id: detail.business.id, staff_id: s.id, admin_pin: pin },
                        (r) => `New PIN issued for ${String(r["display_name"])}${r["alerted"] ? " — alert email sent." : "."}`);
                      setPin("");
                      if (d) { setIssued({ name: String(d["display_name"]), pin: String(d["pin"]) }); setResetting(null); }
                    }}>Issue new PIN</Button>
                    <Button variant="outline" size="sm" onClick={() => { setResetting(null); setPin(""); }}>Cancel</Button>
                  </div>
                </div>
              )}
              {issued && issued.name === s.display_name && (
                <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
                  <p className="text-sm text-emerald-900">New PIN for {issued.name}. Read it out now — it is not shown again.</p>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-white px-3 py-2 font-mono text-xl tracking-[0.3em]">{issued.pin}</span>
                    <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(issued.pin)}>Copy</Button>
                    <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>Hide</Button>
                  </div>
                  <p className="text-xs text-emerald-900">Tell them to change it themselves as soon as they are back in.</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {detail.flags.length > 0 && (
        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold text-card-foreground">Open alerts at this business</h2>
          <ul className="space-y-1 text-sm">
            {detail.flags.map((f) => (
              <li key={f.id} className={f.severity === "critical" ? "text-destructive" : "text-muted-foreground"}>
                {fmt(f.created_at)} · {f.flag_type.replaceAll("_", " ")} — {f.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold text-card-foreground">Recent activity</h2>
        {detail.audit.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
        <ul className="space-y-1 text-sm text-muted-foreground">
          {detail.audit.map((a) => (
            <li key={a.id}>
              <span className="text-foreground">{fmt(a.created_at)}</span> · {a.action.replaceAll("_", " ")} — {a.details}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RecordPayment({ mode, businessId, businessName, suspended, busy, act }: {
  mode: OperatingMode | null; businessId: string; businessName: string; suspended: boolean; busy: boolean; act: Act;
}) {
  const today = lagosDateKey(new Date());
  const [plan, setPlan] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState(false); // once the admin types an amount, the plan price no longer overwrites it
  const [prices, setPrices] = useState<Prices | null>(null);
  const [ref, setRef] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [preview, setPreview] = useState<string | null>(null);
  const [perr, setPerr] = useState<string | null>(null);
  const kobo = Math.round(Number(amount.replace(/[^\d.]/g, "")) * 100);
  const valid = kobo > 0 && ref.trim().length >= 2 && !!paidOn && paidOn <= today;
  const payload = { action: "record_payment", business_id: businessId, plan, amount_kobo: kobo, payment_reference: ref.trim(), paid_on: paidOn };

  useEffect(() => {
    let live = true;
    callApi({ action: "get_settings" }).then(({ status, data }) => {
      if (live && status === 200) setPrices(((data["settings"] ?? {}) as { prices?: Prices }).prices ?? null);
    });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (!typed) setAmount(planPriceInput(prices, mode, plan)); }, [plan, prices, mode, typed]);

  useEffect(() => {
    setPreview(null); setPerr(null);
    let live = true;
    callApi({ ...payload, amount_kobo: kobo > 0 ? kobo : 1, payment_reference: ref.trim() || "preview", preview: true }).then(({ status, data }) => {
      if (!live) return;
      if (status === 200) setPreview(`${formatLagosDate(String(data["period_start"]))} to ${formatLagosDate(String(data["period_end"]))}`);
      else setPerr(String(data["error"] ?? "Could not work out the dates."));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, businessId]);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold text-card-foreground">Record payment</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rp-plan">Plan</Label>
          <select id="rp-plan" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={plan}
            onChange={(e) => setPlan(e.target.value as typeof plan)}>
            <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp-amt">Amount paid (₦)</Label>
          <Input id="rp-amt" inputMode="decimal" value={amount} onChange={(e) => { setTyped(true); setAmount(e.target.value); }} placeholder="e.g. 15000" />
          {mode && planPriceInput(prices, mode, plan) && <p className="text-xs text-muted-foreground">Filled in from the {PLAN_NAME[mode]} {plan} price. You can change it.</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp-ref">Payment reference</Label>
          <Input id="rp-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank transfer reference" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp-date">Date paid</Label>
          <Input id="rp-date" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
      </div>
      {preview && <p className="text-sm text-foreground">This payment will cover <strong>{preview}</strong> (access ends 11:59 pm Lagos time).</p>}
      {perr && <p className="text-sm text-destructive">{perr}</p>}
      {suspended && <p className="text-sm text-amber-900">This business is suspended. Recording a payment does not reactivate it.</p>}
      <Button disabled={busy || !valid} className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90" onClick={async () => {
        const d = await act(payload, (r) => `Payment saved for ${businessName}. Access now runs until ${formatLagosDate(String(r["period_end"]))}.${r["still_suspended"] ? " The business is still suspended." : ""}`);
        if (d) { setTyped(false); setAmount(planPriceInput(prices, mode, plan)); setRef(""); }
      }}>Save payment</Button>
    </section>
  );
}

function MyAccount() {
  const [pins, setPins] = useState({ current: "", next: "" });
  const [note, setNote] = useState<string | null>(null);
  return (
    <section className="max-w-md space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold text-card-foreground">Change my PIN</h2>
      <p className="text-sm text-muted-foreground">Your PIN also confirms suspensions and emergency resets, so keep it to yourself.</p>
      <div className="grid grid-cols-2 gap-3">
        <Input type="password" inputMode="numeric" placeholder="Current PIN" value={pins.current}
          onChange={(e) => setPins({ ...pins, current: e.target.value.replace(/\D/g, "") })} />
        <Input type="password" inputMode="numeric" placeholder="New PIN (4–8 digits)" value={pins.next}
          onChange={(e) => setPins({ ...pins, next: e.target.value.replace(/\D/g, "") })} />
      </div>
      {note && <p className="text-sm">{note}</p>}
      <Button variant="outline" disabled={pins.current.length < 4 || pins.next.length < 4} onClick={async () => {
        const { data: s } = await supabase.auth.getSession();
        const res = await fetch("/api/public/staff-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
          body: JSON.stringify({ action: "change_own_pin", current_pin: pins.current, new_pin: pins.next }),
        });
        const d = await res.json().catch(() => ({}));
        setNote(d.ok ? "Your PIN has been changed." : (d.error ?? "Could not change PIN."));
        if (d.ok) setPins({ current: "", next: "" });
      }}>Change PIN</Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Platform health — read-only vitals across every kitchen on the platform.
// ---------------------------------------------------------------------------
function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "good" | "warn" | "bad" | undefined; hint?: string | undefined }) {
  const toneClass = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "text-card-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function HealthBoard({ onInspect, onAudit }: { onInspect: (id: string) => void; onAudit: (id: string) => void }) {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { status, data } = await callApi({ action: "platform_health" });
    setBusy(false);
    if (status !== 200) return setErr(String(data["error"] ?? "Could not load platform health."));
    setH(data as unknown as Health);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (err) return <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{err}</p>;
  if (!h) return <p className="text-muted-foreground">Checking the platform…</p>;

  const slow = h.latency_ms > 1500;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`inline-block size-2.5 rounded-full ${slow ? "bg-amber-500" : "bg-emerald-500"}`} />
          <span className="font-medium text-foreground">{slow ? "Responding slowly" : "All systems responding"}</span>
          <span className="text-muted-foreground">· {h.latency_ms} ms · checked {fmt(h.generated_at)}</span>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={load}>
          <RefreshCw className={busy ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold text-foreground"><Building2 className="size-4" /> Kitchens</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Active" value={String(h.tenants.approved)} hint={`${h.tenants.total} registered in total`} />
          <Stat label="Waiting" value={String(h.tenants.pending)} tone={h.tenants.pending ? "warn" : undefined} hint="Signups to review" />
          <Stat label="Suspended" value={String(h.tenants.suspended)} tone={h.tenants.suspended ? "bad" : undefined} />
          <Stat label="Rejected" value={String(h.tenants.rejected)} />
          <Stat label="On free trial" value={String(h.tenants.on_trial ?? 0)} />
          <Stat label="Paid and active" value={String(h.tenants.active_paid ?? 0)} tone={h.tenants.active_paid ? "good" : undefined} />
          <Stat label="Plan ended" value={String(h.tenants.expired ?? 0)} tone={h.tenants.expired ? "bad" : undefined} hint="Approved but locked" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold text-foreground"><Users className="size-4" /> People and sign-ins</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Active staff" value={String(h.people.active_staff)} />
          <Stat label="Locked out now" value={String(h.people.locked_now)} tone={h.people.locked_now ? "bad" : undefined} hint="Cannot sign in" />
          <Stat label="Wrong PINs (24h)" value={String(h.people.failed_logins_24h)}
            tone={h.people.failed_logins_24h > 20 ? "warn" : undefined} />
          <Stat label="Sign-ins (24h)" value={String(h.people.successful_logins_24h)} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold text-foreground"><Activity className="size-4" /> Trading</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sales today" value={naira(h.activity.gmv_today_kobo)} hint={`${h.activity.orders_today} orders`} />
          <Stat label="Sales this week" value={naira(h.activity.gmv_week_kobo)} />
          <Stat label="Open alerts" value={String(h.flags.open_total)} tone={h.flags.critical ? "bad" : h.flags.open_total ? "warn" : undefined}
            hint={h.flags.critical ? `${h.flags.critical} serious` : "Across all kitchens"} />
          <Stat label="Events (24h)" value={String(h.activity.events_24h)} hint="Recorded in the audit trail" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold text-foreground"><ShieldAlert className="size-4" /> Needs a look</h2>
        {h.watchlist.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Nothing needs attention. No lockouts and no open alerts anywhere.
          </p>
        ) : (
          <ul className="space-y-2">
            {h.watchlist.map((w) => (
              <li key={w.business_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div className="min-w-0">
                  <div className="font-medium text-card-foreground">{w.business_name}</div>
                  <div className="text-sm text-muted-foreground">{w.reasons.join(" · ")}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onInspect(w.business_id)}>Troubleshoot</Button>
                  <Button size="sm" variant="ghost" onClick={() => onAudit(w.business_id)}>History</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold text-card-foreground">Recent platform actions</h2>
        {h.recent_ops.length === 0 && <p className="text-sm text-muted-foreground">No platform actions recorded yet.</p>}
        <ul className="space-y-1 text-sm text-muted-foreground">
          {h.recent_ops.map((o) => (
            <li key={o.id}>
              <span className="text-foreground">{fmt(o.created_at)}</span> · {o.business_name} · {words(o.action)} — {o.details}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tenant audit inspector — search the immutable record across every kitchen.
// ---------------------------------------------------------------------------
const CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "logins", label: "Sign-ins" },
  { key: "security", label: "Staff & PINs" },
  { key: "money", label: "Money" },
  { key: "recipes", label: "Recipes & costs" },
  { key: "platform_ops", label: "Platform actions" },
];

const ACTION_TONE = (a: string) =>
  a.includes("failed") || a.includes("locked") || a.includes("blocked") || a.includes("discrepancy")
  || a.includes("suspended") || a.includes("undelivered")
    ? "bg-red-100 text-red-800"
    : a.startsWith("business_") || a.startsWith("platform_") || a.startsWith("emergency_")
      ? "bg-indigo-100 text-indigo-800"
      : a.includes("login_success")
        ? "bg-emerald-100 text-emerald-800"
        : "bg-slate-200 text-slate-700";

function AuditInspector({ businesses, initialBusiness }: { businesses: Biz[]; initialBusiness: string }) {
  const [bizId, setBizId] = useState(initialBusiness);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const LIMIT = 50;

  const load = useCallback(async (nextOffset: number) => {
    setBusy(true); setErr(null);
    const { status, data } = await callApi({
      action: "audit_query",
      ...(bizId ? { business_id: bizId } : {}),
      category,
      ...(search.trim() ? { search: search.trim() } : {}),
      limit: LIMIT,
      offset: nextOffset,
    });
    setBusy(false);
    if (status !== 200) return setErr(String(data["error"] ?? "Could not load the audit trail."));
    setEvents((data["events"] ?? []) as AuditEvent[]);
    setTotal(Number(data["total"] ?? 0));
    setOffset(nextOffset);
  }, [bizId, category, search]);

  useEffect(() => { load(0); }, [bizId, category]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv() {
    const head = ["When (Lagos)", "Business", "Event", "Who", "Role", "Details"];
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const body = events.map((e) => [fmt(e.created_at), e.business_name, e.action, e.actor_name, e.actor_role ?? "", e.details ?? ""].map(esc).join(","));
    const blob = new Blob([[head.map(esc).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nairaplate-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="audit-biz">Kitchen</Label>
          <select id="audit-biz" value={bizId} onChange={(e) => setBizId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Every kitchen</option>
            {businesses.map((b) => <option key={b.business_id} value={b.business_id}>{b.business_name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-cat">Kind of event</Label>
          <select id="audit-cat" value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(0); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search the details — a name, an amount, an ingredient" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={busy}>Search</Button>
        <Button type="button" variant="ghost" disabled={events.length === 0} onClick={exportCsv} title="Download as a spreadsheet">
          <Download />
        </Button>
      </form>

      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{err}</p>}

      <p className="text-sm text-muted-foreground">
        {busy ? "Loading…" : total === 0 ? "Nothing recorded for that." :
          `Showing ${offset + 1}–${Math.min(offset + events.length, total)} of ${total} events.`}
      </p>

      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACTION_TONE(e.action)}`}>{words(e.action)}</span>
              <span className="text-sm font-medium text-card-foreground">{e.business_name}</span>
              <span className="text-xs text-muted-foreground">{fmt(e.created_at)}</span>
            </div>
            <div className="mt-1 text-sm text-card-foreground">{e.details ?? "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {e.actor_name}{e.actor_role ? ` · ${roleLabel(e.actor_role)}` : ""}
            </div>
          </li>
        ))}
      </ul>

      {total > LIMIT && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy || offset === 0} onClick={() => load(Math.max(0, offset - LIMIT))}>Newer</Button>
          <Button variant="outline" size="sm" disabled={busy || offset + LIMIT >= total} onClick={() => load(offset + LIMIT)}>Older</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Website contact messages. Saved before any email is tried, so no lead is lost.
// ---------------------------------------------------------------------------
type ContactMsg = {
  id: string; name: string; business_name: string | null; contact: string; message: string;
  created_at: string; handled: boolean; handled_at: string | null;
};

function Messages({ onCount }: { onCount: (n: number) => void }) {
  const [view, setView] = useState<"unhandled" | "handled">("unhandled");
  const [rows, setRows] = useState<ContactMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { status, data } = await callApi({ action: "list_messages", handled: view === "handled" });
    setBusy(false);
    if (status !== 200) return setErr(String(data["error"] ?? "Could not load messages."));
    setRows((data["messages"] ?? []) as ContactMsg[]);
    onCount(Number(data["unhandled"] ?? 0));
  }, [view, onCount]);

  useEffect(() => { load(); }, [load]);

  async function markHandled(id: string) {
    setBusy(true); setErr(null);
    const { status, data } = await callApi({ action: "mark_message_handled", message_id: id });
    setBusy(false);
    if (status !== 200) return setErr(String(data["error"] ?? "Could not update the message."));
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["unhandled", "handled"] as const).map((v) => (
          <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}
            className={view === v ? "bg-brand-blue text-brand-inverse hover:bg-brand-blue/90" : ""}>
            {v === "unhandled" ? "Unhandled" : "Handled"}
          </Button>
        ))}
      </div>
      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{err}</p>}
      {busy && rows.length === 0 ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
        <p className="text-muted-foreground">{view === "unhandled" ? "No messages waiting." : "No handled messages yet."}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <li key={m.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-card-foreground">{m.name}</span>
                {m.business_name && <span className="text-sm text-muted-foreground">({m.business_name})</span>}
                <span className="text-xs text-muted-foreground">{fmt(m.created_at)}</span>
              </div>
              <div className="text-sm text-muted-foreground">{m.contact}</div>
              <p className="whitespace-pre-wrap text-sm text-card-foreground">{m.message}</p>
              {m.handled ? (
                <div className="text-xs text-muted-foreground">Handled {m.handled_at ? fmt(m.handled_at) : ""}</div>
              ) : (
                <Button size="sm" disabled={busy} className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90"
                  onClick={() => markHandled(m.id)}>Mark handled</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
