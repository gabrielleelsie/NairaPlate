import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { PLAN_MODES, PLAN_NAME, formatPrice, setupText } from "@/lib/platform-settings";
import { usePublicSettings } from "@/lib/use-public-settings";
import { PLAN_TERMS, TERM_LABEL, amountFor, isMode, type PlanTerm } from "@/lib/plan-choice";
import type { OperatingMode } from "@/lib/features";
import { SELAR_SUBSCRIBE_URL } from "@/lib/selar-links";
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

function ChoosePlanPage() {
  const { prices } = usePublicSettings();
  const search = Route.useSearch();
  // Coming from one plan's own Subscribe button (for example Buka), only that plan is shown.
  const shown: OperatingMode[] = search.type ? [search.type] : PLAN_MODES;
  const [mode, setMode] = useState<OperatingMode | null>(search.type ?? null);
  const [term, setTerm] = useState<PlanTerm | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = mode && term ? amountFor(prices, mode, term) : null;
  const ready = !!mode && !!term && amount !== null;

  async function proceed() {
    if (!mode || !term) return;
    setBusy(true);
    // If an owner is signed in, remember the choice so the payment can be checked against it. Never blocks the payment.
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        await fetch("/api/public/plan-choice", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mode, term }),
        });
      }
    } catch {
      /* the owner still goes on to pay */
    }
    window.location.assign(SELAR_SUBSCRIBE_URL);
  }

  const choiceStyle = (on: boolean): React.CSSProperties => ({
    ...cardStyle,
    padding: 20,
    textAlign: "left",
    cursor: "pointer",
    border: `2px solid ${on ? C.blue : "transparent"}`,
    background: C.white,
    color: C.navy,
    font: "inherit",
  });

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
            <h2 style={{ color: C.navy, fontSize: 24, fontWeight: 800, margin: "0 0 16px" }}>1. Plan</h2>
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              {shown.map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} style={choiceStyle(mode === m)}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{PLAN_NAME[m]}</div>
                  <div style={{ color: C.muted, marginTop: 6 }}>{formatPrice(amountFor(prices, m, "monthly")) ?? "Ask us"} a month</div>
                </button>
              ))}
            </div>

            <h2 style={{ color: C.navy, fontSize: 24, fontWeight: 800, margin: "32px 0 16px" }}>2. How long</h2>
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
                  <div style={{ color: C.navy, fontSize: 26, fontWeight: 800, marginTop: 4 }}>
                    {PLAN_NAME[mode]}, {TERM_LABEL[term].toLowerCase()}: {formatPrice(amount)}
                  </div>
                  {setupText(prices.plans[mode]) && (
                    <p style={{ color: C.muted, fontSize: 16, margin: "8px 0 0" }}>Setup with our team, paid once: {setupText(prices.plans[mode])}</p>
                  )}
                </>
              ) : (
                <div style={{ color: C.muted, fontSize: 17 }}>Choose a plan and how long you want to pay for.</div>
              )}
              <button
                type="button"
                disabled={!ready || busy}
                onClick={() => void proceed()}
                style={{
                  marginTop: 20, minHeight: 48, padding: "12px 28px", borderRadius: 12, border: "none", fontSize: 17, fontWeight: 700,
                  background: ready ? C.blue : "#b8c4d0", color: C.white, cursor: ready && !busy ? "pointer" : "not-allowed",
                }}
              >
                {busy ? "One moment…" : "Continue"}
              </button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
