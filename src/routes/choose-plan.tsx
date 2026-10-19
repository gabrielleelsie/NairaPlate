import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLAN_MODES, PLAN_NAME, formatPrice, setupText } from "@/lib/platform-settings";
import { usePublicSettings } from "@/lib/use-public-settings";
import { PLAN_TERMS, TERM_LABEL, amountFor, isMode, type PlanTerm } from "@/lib/plan-choice";
import type { OperatingMode } from "@/lib/features";
import { SELAR_SETUP_URL, SELAR_SUBSCRIBE_URL } from "@/lib/selar-links";
import { C, cardStyle, FONT_STACK, SiteFooter, SiteHeader } from "@/components/site/site-chrome";

const TITLE = "Choose your plan | NairaPlate";
const DESCRIPTION = "Choose your NairaPlate plan and how long you want to pay for.";

export const Route = createFileRoute("/choose-plan")({
  validateSearch: (s: Record<string, unknown>): { type?: OperatingMode } => (isMode(s["type"]) ? { type: s["type"] } : {}),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChoosePlanPage,
});

// mode: the plan type an existing store already has. An existing customer is shown only that plan; a new store is shown the plans.
type Who =
  | { kind: "signed_in"; email: string | null; setupPaid: boolean; mode: OperatingMode | null }
  | { kind: "existing"; businessId: string; email: string; setupPaid: boolean; mode: OperatingMode | null }
  | { kind: "new"; businessId: string; email: string; setupPaid: boolean };

async function post(url: string, body: unknown, token?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function ChoosePlanPage() {
  const { prices } = usePublicSettings();
  const search = Route.useSearch();
  const [who, setWho] = useState<Who | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<"ask" | "existing" | "new">("ask");

  // A signed-in owner is already known, so the questions are skipped.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const r = await post("/api/public/subscribe-intake", { action: "me" }, token);
          if (live && r.data["ok"] === true) setWho({ kind: "signed_in", email: (r.data["email"] as string | null) ?? null, setupPaid: r.data["setup_paid"] === true, mode: isMode(r.data["operating_mode"]) ? r.data["operating_mode"] : null });
        }
      } catch {
        /* not signed in: the questions are shown */
      }
      if (live) setChecking(false);
    })();
    return () => { live = false; };
  }, []);

  return (
    <div className="np-public" style={{ fontFamily: FONT_STACK }}>
      <SiteHeader />
      <main>
        <section style={{ background: C.navy, padding: "56px 24px 64px" }}>
          <div style={{ maxWidth: 1140, margin: "0 auto" }}>
            <Link to="/pricing" style={{ color: C.onNavy, display: "inline-block", fontSize: 16, fontWeight: 700, marginBottom: 20, textDecoration: "none" }}>
              ← Back to pricing
            </Link>
            <h1 className="np-h1" style={{ color: C.white, margin: 0 }}>Choose your plan</h1>
          </div>
        </section>
        <section className="np-section" style={{ background: C.light }}>
          <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 24px" }}>
            {checking ? (
              <p style={{ color: C.muted, fontSize: 17 }}>One moment…</p>
            ) : who ? (
              <PlanChooser who={who} prices={prices} only={search.type} />
            ) : step === "ask" ? (
              <Ask onPick={setStep} />
            ) : step === "existing" ? (
              <ExistingForm onBack={() => setStep("ask")} onDone={setWho} />
            ) : (
              <NewForm onBack={() => setStep("ask")} onDone={setWho} />
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Ask({ onPick }: { onPick: (s: "existing" | "new") => void }) {
  const box: React.CSSProperties = { ...cardStyle, padding: 24, textAlign: "left", cursor: "pointer", border: "2px solid transparent", background: C.white, color: C.navy, font: "inherit" };
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ color: C.navy, fontSize: 26, fontWeight: 800, margin: "0 0 16px" }}>Are you an existing customer or new?</h2>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <button type="button" style={box} onClick={() => onPick("existing")}><div style={{ fontSize: 22, fontWeight: 800 }}>Existing customer</div></button>
        <button type="button" style={box} onClick={() => onPick("new")}><div style={{ fontSize: 22, fontWeight: 800 }}>New customer</div></button>
      </div>
    </div>
  );
}

function ExistingForm({ onBack, onDone }: { onBack: () => void; onDone: (w: Who) => void }) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await post("/api/public/subscribe-intake", { action: "verify_existing", business_id: code.trim().toLowerCase(), email });
    setBusy(false);
    if (r.data["ok"] === true) onDone({ kind: "existing", businessId: code.trim().toLowerCase(), email: String(r.data["email"] ?? email), setupPaid: r.data["setup_paid"] === true, mode: isMode(r.data["operating_mode"]) ? r.data["operating_mode"] : null });
    else setError("We could not find that store. Check the business code and the email on the account.");
  }
  return (
    <form onSubmit={submit} style={{ maxWidth: 480 }} className="space-y-4">
      <h2 style={{ color: C.navy, fontSize: 26, fontWeight: 800, margin: 0 }}>Your store</h2>
      <div className="space-y-1"><Label htmlFor="ec">Business code</Label><Input id="ec" value={code} onChange={(e) => setCode(e.target.value)} placeholder="mama-put" /></div>
      <div className="space-y-1"><Label htmlFor="ee">Email on your account</Label><Input id="ee" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !code.trim() || !email.trim()}>{busy ? "Checking…" : "Continue"}</Button>
        <Button type="button" variant="outline" onClick={onBack}>Back</Button>
      </div>
    </form>
  );
}

function NewForm({ onBack, onDone }: { onBack: () => void; onDone: (w: Who) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [owner, setOwner] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [codeNote, setCodeNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [taken, setTaken] = useState<{ email: boolean; name: boolean }>({ email: false, name: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = code.trim().toLowerCase();
    if (!c) return setCodeNote(null);
    const t = setTimeout(async () => {
      const r = await post("/api/public/business-signup", { action: "check_code", business_id: c });
      if (r.data["error"]) setCodeNote({ ok: false, text: String(r.data["error"]) });
      else setCodeNote(r.data["available"] ? { ok: true, text: "Available" } : { ok: false, text: "That code is taken. Try another." });
    }, 400);
    return () => clearTimeout(t);
  }, [code]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!email.trim() && name.trim().length < 2) return setTaken({ email: false, name: false });
      const r = await post("/api/public/subscribe-intake", { action: "check_new", email, name });
      setTaken({ email: r.data["email_taken"] === true, name: r.data["name_taken"] === true });
    }, 400);
    return () => clearTimeout(t);
  }, [email, name]);

  const pinOk = /^\d{4,8}$/.test(pin) && pin === pin2;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = name.trim().length >= 2 && owner.trim() && emailOk && pinOk && codeNote?.ok === true && !taken.email && !taken.name && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(null);
    const r = await post("/api/public/business-signup", { action: "signup", business_id: code.trim().toLowerCase(), name, owner_name: owner, pin, contact: email.trim(), via_payment: true });
    setBusy(false);
    if (r.data["ok"]) onDone({ kind: "new", businessId: code.trim().toLowerCase(), email: email.trim().toLowerCase(), setupPaid: false });
    else setError(String(r.data["error"] ?? "Could not register."));
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 480 }} className="space-y-4">
      <h2 style={{ color: C.navy, fontSize: 26, fontWeight: 800, margin: 0 }}>Your details</h2>
      <div className="space-y-1"><Label htmlFor="nn">Business name</Label><Input id="nn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mama Put Kitchen" />
        {taken.name && <p className="text-xs text-destructive">A store with that name already exists.</p>}</div>
      <div className="space-y-1"><Label htmlFor="nc">Business code (what your staff type to sign in)</Label>
        <Input id="nc" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s+/g, "-"))} placeholder="mama-put" />
        {codeNote && <p className={`text-xs ${codeNote.ok ? "text-primary" : "text-destructive"}`}>{codeNote.text}</p>}</div>
      <div className="space-y-1"><Label htmlFor="no">Your name</Label><Input id="no" value={owner} onChange={(e) => setOwner(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="ne">Your email</Label><Input id="ne" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {taken.email && <p className="text-xs text-destructive">That email is already registered to a store. Go back and choose Existing customer.</p>}</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label htmlFor="p1">Your PIN (4 to 8 digits)</Label>
          <Input id="p1" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
        <div className="space-y-1"><Label htmlFor="p2">PIN again</Label>
          <Input id="p2" type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
      </div>
      {pin2 && pin !== pin2 && <p className="text-xs text-destructive">The two PINs do not match.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit}>{busy ? "Saving…" : "Continue"}</Button>
        <Button type="button" variant="outline" onClick={onBack}>Back</Button>
      </div>
    </form>
  );
}

function PlanChooser({ who, prices, only }: { who: Who; prices: ReturnType<typeof usePublicSettings>["prices"]; only: OperatingMode | undefined }) {
  // An existing customer is shown only their own plan type. Otherwise, coming from one plan's own Subscribe button (for example Buka), only that plan is shown.
  const own = who.kind === "new" ? null : who.mode;
  const shown: OperatingMode[] = own ? [own] : only ? [only] : PLAN_MODES;
  const [mode, setMode] = useState<OperatingMode | null>(own ?? only ?? null);
  const [term, setTerm] = useState<PlanTerm | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = mode && term ? amountFor(prices, mode, term) : null;
  const ready = !!mode && !!term && amount !== null;

  async function proceed() {
    if (!mode || !term) return;
    setBusy(true);
    // Remember the choice so the payment can be checked against it. Never blocks the payment.
    try {
      if (who.kind === "signed_in") {
        const { data } = await supabase.auth.getSession();
        await post("/api/public/plan-choice", { mode, term }, data.session?.access_token);
      } else {
        await post("/api/public/plan-choice", { mode, term, business_id: who.businessId, email: who.email });
      }
    } catch {
      /* the owner still goes on to pay */
    }
    window.location.assign(SELAR_SUBSCRIBE_URL);
  }

  const choiceStyle = (on: boolean): React.CSSProperties => ({
    ...cardStyle, padding: 20, textAlign: "left", cursor: "pointer", border: `2px solid ${on ? C.blue : "transparent"}`, background: C.white, color: C.navy, font: "inherit",
  });

  return (
    <>
      {who.email && <p style={{ color: C.muted, fontSize: 17, margin: "0 0 24px" }}>Use this email when you pay: <strong style={{ color: C.navy }}>{who.email}</strong></p>}

      {!who.setupPaid && (
        <div style={{ ...cardStyle, padding: 24, marginBottom: 32 }}>
          <h2 style={{ color: C.navy, fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>Step 1. Pay the setup fee</h2>
          {mode && setupText(prices.plans[mode]) && <p style={{ color: C.muted, fontSize: 16, margin: "0 0 12px" }}>Paid once: {setupText(prices.plans[mode])}</p>}
          <a
            href={SELAR_SETUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 48, padding: "12px 28px", borderRadius: 12, fontSize: 17, fontWeight: 700, textDecoration: "none", background: "transparent", color: C.navy, border: `2px solid ${C.navy}` }}
          >
            Pay setup fee
          </a>
        </div>
      )}

      <h2 style={{ color: C.navy, fontSize: 24, fontWeight: 800, margin: "0 0 16px" }}>{who.setupPaid ? "1. Plan" : "Step 2. Plan"}</h2>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {shown.map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} style={choiceStyle(mode === m)}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{PLAN_NAME[m]}</div>
            <div style={{ color: C.muted, marginTop: 6 }}>{formatPrice(amountFor(prices, m, "monthly")) ?? "Ask us"} a month</div>
          </button>
        ))}
      </div>

      <h2 style={{ color: C.navy, fontSize: 24, fontWeight: 800, margin: "32px 0 16px" }}>{who.setupPaid ? "2. How long" : "Step 3. How long"}</h2>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {PLAN_TERMS.map((t) => (
          <button key={t} type="button" onClick={() => setTerm(t)} aria-pressed={term === t} style={choiceStyle(term === t)}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{TERM_LABEL[t]}</div>
            <div style={{ color: C.muted, marginTop: 6 }}>{mode ? (formatPrice(amountFor(prices, mode, t)) ?? "Ask us") : "Choose a plan first"}</div>
          </button>
        ))}
      </div>

      <div style={{ ...cardStyle, padding: 24, marginTop: 32 }}>
        {ready && mode && term ? (
          <>
            <div style={{ color: C.muted, fontSize: 16 }}>Your choice</div>
            <div style={{ color: C.navy, fontSize: 26, fontWeight: 800, marginTop: 4 }}>{PLAN_NAME[mode]}, {TERM_LABEL[term].toLowerCase()}: {formatPrice(amount)}</div>
          </>
        ) : (
          <div style={{ color: C.muted, fontSize: 17 }}>Choose a plan and how long you want to pay for.</div>
        )}
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void proceed()}
          style={{ marginTop: 20, minHeight: 48, padding: "12px 28px", borderRadius: 12, border: "none", fontSize: 17, fontWeight: 700, background: ready ? C.blue : "#b8c4d0", color: C.white, cursor: ready && !busy ? "pointer" : "not-allowed" }}
        >
          {busy ? "One moment…" : "Continue"}
        </button>
        <p style={{ color: C.muted, fontSize: 15, margin: "14px 0 0" }}>Your access is switched on once your payment is confirmed.</p>
      </div>
    </>
  );
}
