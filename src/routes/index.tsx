import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Share, ShieldCheck, Scale, Bell, Wallet, X } from "lucide-react";

import walkthroughAsset from "@/assets/nairaplate-walkthrough.mp4.asset.json";
import adminDemoAsset from "@/assets/nairaplate-admin-demo.mp4.asset.json";
import calcDemoAsset from "@/assets/nairaplate-price-calculator-demo.mp4.asset.json";
import calcPosterAsset from "@/assets/nairaplate-price-calculator-poster.jpg.asset.json";
import walkPosterAsset from "@/assets/nairaplate-walkthrough-poster.jpg.asset.json";
import adminPosterAsset from "@/assets/nairaplate-admin-poster.jpg.asset.json";

import { computeRecipeCost, formatNaira } from "@/lib/costing";
import {
  DEMO_CONVERSIONS,
  DEMO_INGREDIENTS,
  EBA_EGUSI_ITEMS,
  EBA_EGUSI_PLATES,
} from "@/components/site/plate-calculator";
import {
  C,
  FloatingWhatsApp,
  OutlineLink,
  PrimaryButton,
  PrimaryLink,
  SecondaryButton,
  SiteFooter,
  SiteHeader,
  WHATSAPP_HREF,
  WhatsAppButton,
  cardStyle,
} from "@/components/site/site-chrome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NairaPlate — Real-Time Food Costing for Nigerian Kitchens" },
      {
        name: "description",
        content:
          "Track food costs in real Nigerian market units, protect your margins when prices spike, and run your kitchen with secure staff PINs. Start a 14-day free trial.",
      },
      { property: "og:title", content: "NairaPlate — Real-Time Food Costing for Nigerian Kitchens" },
      {
        property: "og:description",
        content:
          "Track food costs in real Nigerian market units, protect your margins when prices spike, and run your kitchen with secure staff PINs. Start a 14-day free trial.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketingPage,
});

const MAX = 1140;
const MEDIA_ORIGIN = "https://id-preview--bbbf4c9a-1779-4134-b130-41f2d8e91702.lovable.app";

function mediaUrl(path: string) {
  return `${MEDIA_ORIGIN}${path}`;
}

function Section({
  bg,
  children,
  id,
}: {
  bg: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="np-section" style={{ background: bg }}>
      <div style={{ maxWidth: MAX, margin: "0 auto", padding: "0 24px" }}>{children}</div>
    </section>
  );
}

function Heading({ children, onNavy }: { children: React.ReactNode; onNavy?: boolean }) {
  return (
    <h2 className="np-h2" style={{ color: onNavy ? C.white : C.navy, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>
      {children}
    </h2>
  );
}

/** Cost of the Eba & Egusi example — the app's own computeRecipeCost(), same formula as the kitchen screens. */
function useEbaEgusi(marginPct: number) {
  return useMemo(
    () =>
      computeRecipeCost({
        items: EBA_EGUSI_ITEMS,
        ingredients: DEMO_INGREDIENTS,
        conversions: DEMO_CONVERSIONS,
        yield_portions: EBA_EGUSI_PLATES,
        target_margin_bps: Math.round(marginPct * 100),
      }),
    [marginPct],
  );
}

function MarketingPage() {
  return (
    <div style={{ fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <SiteHeader />
      <main>
        <Hero />
        <InstallGuide />
        <Features />
        <LiveCalculator />
        <DemoVideos />
        <TrialOffer />
        <WhatsAppSection />
      </main>
      <SiteFooter />
      <FloatingWhatsApp />
    </div>
  );
}

function Hero() {
  const result = useEbaEgusi(35);
  return (
    <section className="np-hero" style={{ background: C.navy }}>
      <div
        style={{
          maxWidth: MAX,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          flexWrap: "wrap",
          gap: 40,
          alignItems: "center",
        }}
      >
        <div style={{ flex: "1 1 460px", minWidth: 280 }}>
          <h1 className="np-h1" style={{ color: C.white, fontWeight: 700, lineHeight: 1.15, margin: 0 }}>
            Stop Guessing Plate Costs. Run Your Nigerian Kitchen by the Numbers.
          </h1>
          <p
            className="np-sub"
            style={{ color: C.onNavy, fontWeight: 400, lineHeight: 1.5, maxWidth: 640, marginTop: 20 }}
          >
            Track food costs in real Nigerian market units (mudu, paint rubber, derica), protect your dish margins
            when market prices jump, and control your cash drawer with simple staff PINs.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 32 }}>
            <PrimaryLink to="/signup">Start 14-Day Free Trial</PrimaryLink>
            <SecondaryButton
              onClick={() => document.getElementById("download")?.scrollIntoView({ behavior: "smooth" })}
            >
              Download the App
            </SecondaryButton>
          </div>
          <div style={{ marginTop: 24 }}>
            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="np-text-link"
              style={{ color: C.white, fontSize: 16, fontWeight: 600, textDecoration: "none" }}
            >
              Chat on WhatsApp
            </a>
          </div>
        </div>

        <div style={{ flex: "1 1 380px", minWidth: 280 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, letterSpacing: 0.4 }}>RECIPE BUILDER</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.navy, marginTop: 4 }}>Eba &amp; Egusi</div>
            <div style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>{EBA_EGUSI_PLATES} plates · target margin 35%</div>
            <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
              {result.lines.map((l) => (
                <div key={l.ingredient_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
                  <span style={{ color: C.text }}>
                    {l.quantity} {l.unit} {l.ingredient_name}
                  </span>
                  <span style={{ color: C.navy, fontWeight: 600 }}>{formatNaira(l.line_cost_kobo)}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 16, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.muted }}>
                <span>Cost per plate</span>
                <span style={{ color: C.navy, fontWeight: 700 }}>{formatNaira(result.cost_per_plate_kobo)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.muted }}>
                <span>Selling price per plate</span>
                <span style={{ color: C.success, fontWeight: 700, fontSize: 20 }}>
                  {formatNaira(result.suggested_price_kobo)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InstallGuide() {
  const [platform, setPlatform] = useState<"android" | "ios" | "desktop">("desktop");
  const [androidBrowser, setAndroidBrowser] = useState<"samsung" | "other">("other");
  const [deferred, setDeferred] = useState<{
    prompt: () => Promise<void>;
    userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
  } | null>(null);
  const [showManualSteps, setShowManualSteps] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) {
      setPlatform("android");
      if (/SamsungBrowser/i.test(ua)) setAndroidBrowser("samsung");
    }
    else if (/iPad|iPhone|iPod/.test(ua)) setPlatform("ios");
    else setPlatform("desktop");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(
        e as unknown as {
          prompt: () => Promise<void>;
          userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
        },
      );
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const onInstallClick = async () => {
    // Always reveal instructions first. Some mobile browsers do not support
    // a one-tap prompt, and install prompts are unavailable inside previews.
    setShowManualSteps(true);
    window.requestAnimationFrame(() => {
      document.getElementById("android-install-steps")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    if (!deferred) return;

    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice?.outcome === "accepted") {
      setShowManualSteps(false);
    }
    setDeferred(null);
  };

  return (
    <Section bg={C.light} id="download">
      <Heading>Get NairaPlate on Your Phone.</Heading>
      <div style={{ ...cardStyle, maxWidth: 480, margin: "32px auto 0" }}>
        {platform === "android" && (
          <>
            <p style={{ fontSize: 16, color: C.text, lineHeight: 1.6, marginTop: 0 }}>
              Install NairaPlate to your home screen.
            </p>
            <PrimaryButton
              type="button"
              onClick={onInstallClick}
              aria-expanded={showManualSteps}
              aria-controls="android-install-steps"
            >
              {deferred ? "Install App" : "Show Install Steps"}
            </PrimaryButton>
            {showManualSteps && (
              <div
                id="android-install-steps"
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 20,
                  padding: 16,
                  border: `1px solid ${C.blue}`,
                  borderRadius: 8,
                  textAlign: "left",
                  display: "grid",
                  gap: 10,
                }}
              >
                <p style={{ fontSize: 14, fontWeight: 600, color: C.navy, margin: 0 }}>
                  Install NairaPlate from your browser menu:
                </p>
                {androidBrowser === "samsung" ? (
                  <>
                    <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.5 }}>
                      1. Tap the <strong>☰ menu</strong> at the bottom-right of Samsung Internet
                    </p>
                    <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.5 }}>
                      2. Tap <strong>Add page to</strong>, then <strong>Home screen</strong>
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.5 }}>
                      1. Tap the <strong>⋮ browser menu</strong>
                    </p>
                    <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.5 }}>
                      2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>
                    </p>
                  </>
                )}
                <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.5 }}>
                  3. Confirm <strong>Install</strong> or <strong>Add</strong>. The NairaPlate icon will appear on your phone.
                </p>
              </div>
            )}
          </>
        )}
        {platform === "ios" && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Share size={32} color={C.blue} />
              <span style={{ fontSize: 16, color: C.text }}>1. Tap the Share icon</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Plus size={32} color={C.blue} />
              <span style={{ fontSize: 16, color: C.text }}>2. Tap 'Add to Home Screen'</span>
            </div>
          </div>
        )}
        {platform === "desktop" && (
          <>
            <p style={{ fontSize: 16, color: C.text, lineHeight: 1.6, marginTop: 0 }}>
              Use NairaPlate as a web app on this computer.
            </p>
            <PrimaryLink to="/app">Open Kitchen POS Web Station</PrimaryLink>
          </>
        )}
      </div>
    </Section>
  );
}

const FEATURES = [
  {
    icon: Scale,
    title: "18 Real Market Units, Not Foreign Ones.",
    body:
      "Mudus, milk cups, paint rubbers, basins, heaps, and jerry cans — the units you actually buy in, not grams and pounds.",
  },
  {
    icon: Bell,
    title: "The Margin Alarm.",
    body:
      "The moment garri, pepper, or palm oil rises more than 5%, every dish using it is flagged automatically for a pricing decision.",
  },
  {
    icon: ShieldCheck,
    title: "Staff PIN Security, Zero Shared Passwords.",
    body:
      "Cashiers sell and close the drawer. Cooks log batches and wastage. Owners see the full P&L and 7-day cashflow. Nobody sees more than their role allows.",
  },
  {
    icon: Wallet,
    title: "Every Naira Reconciled.",
    body:
      "Cash drawers are closed with an actual count, not an assumption. Voided sales stay in the record with a reason — nothing is ever silently deleted.",
  },
];

function Features() {
  return (
    <Section bg={C.white}>
      <Heading>Built for How Nigerian Kitchens Actually Run.</Heading>
      <div className="np-feature-grid" style={{ marginTop: 32 }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={cardStyle}>
            <f.icon size={28} color={C.blue} />
            <h3 style={{ fontSize: 18, fontWeight: 600, color: C.navy, margin: "12px 0 8px" }}>{f.title}</h3>
            <p style={{ fontSize: 15, fontWeight: 400, color: C.muted, lineHeight: 1.5, margin: 0 }}>{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DemoVideos() {
  const videos = [
    {
      src: mediaUrl(calcDemoAsset.url),
      poster: mediaUrl(calcPosterAsset.url),
      title: "The price calculator",
      caption:
        "Watch ingredient prices turn into the real cost of a dish — and the price you should charge to protect your margin.",
      featured: true,
    },
    {
      src: mediaUrl(walkthroughAsset.url),
      poster: mediaUrl(walkPosterAsset.url),
      title: "NairaPlate in action",
      caption:
        "A full walkthrough of the app — live costing, margin pricing, purchase logging, and the owner dashboard.",
    },
    {
      src: mediaUrl(adminDemoAsset.url),
      poster: mediaUrl(adminPosterAsset.url),
      title: "Multi-tenant platform control",
      caption:
        "How we onboard, monitor, and support every kitchen on NairaPlate from one platform admin dashboard.",
    },
  ];
  return (
    <Section bg={C.white} id="demo">
      <Heading>See NairaPlate working</Heading>
      <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.6, margin: "16px 0 0", maxWidth: 640 }}>
        Watch the real product — no slides, no mockups. These are recordings of the actual app
        running a real kitchen.
      </p>
      <div
        className="np-video-grid"
        style={{ display: "grid", gap: 32, gridTemplateColumns: "1fr 1fr", marginTop: 40 }}
      >
        {videos.map((v) => (
          <figure
            key={v.src}
            className={v.featured ? "np-video-featured" : undefined}
            style={v.featured ? { gridColumn: "1 / -1", margin: 0 } : { margin: 0 }}
          >
            <div style={{ ...cardStyle, overflow: "hidden", padding: 0 }}>
              <video
                controls
                playsInline
                preload="metadata"
                src={v.src}
                poster={v.poster}
                style={{ display: "block", width: "100%", aspectRatio: "16 / 9", background: C.navy }}
              />
            </div>
            <figcaption style={{ marginTop: 16, maxWidth: 640, marginInline: "auto" }}>
              <div
                style={{
                  color: C.navy,
                  fontSize: v.featured ? 20 : 18,
                  fontWeight: 700,
                  textAlign: v.featured ? "center" : "left",
                }}
              >
                {v.title}
              </div>
              <p
                style={{
                  color: C.muted,
                  fontSize: 15,
                  lineHeight: 1.6,
                  margin: "6px 0 0",
                  textAlign: v.featured ? "center" : "left",
                }}
              >
                {v.caption}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

function LiveCalculator() {
  const [margin, setMargin] = useState(35);
  const [touched, setTouched] = useState(false);
  const [calloutOpen, setCalloutOpen] = useState(false);
  const result = useEbaEgusi(margin);

  const onMarginChange = (value: number) => {
    setMargin(value);
    if (!touched) {
      setTouched(true);
      setCalloutOpen(true);
    }
  };

  return (
    <Section bg={C.light}>
      <Heading>See the Real Cost of a Plate, Right Now.</Heading>
      <p
        style={{
          fontSize: 16,
          fontWeight: 400,
          color: C.text,
          lineHeight: 1.6,
          maxWidth: 560,
          margin: "16px auto 0",
          textAlign: "center",
        }}
      >
        This example uses fixed numbers for Eba &amp; Egusi. Your real kitchen has its own ingredients, your own
        market prices, and dozens of dishes — that's what the app actually tracks.
      </p>
      <div style={{ ...cardStyle, maxWidth: 560, margin: "32px auto 0" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.navy }}>Eba &amp; Egusi</div>
        <div style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>{EBA_EGUSI_PLATES} plates</div>

        <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
          {result.lines.map((l) => (
            <div key={l.ingredient_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
              <span style={{ color: C.text }}>
                {l.quantity} {l.unit} {l.ingredient_name}
              </span>
              <span style={{ color: C.navy, fontWeight: 600 }}>{formatNaira(l.line_cost_kobo)}</span>
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.muted }}>
            <span>Cost per plate</span>
            <span style={{ color: C.navy, fontWeight: 700 }}>{formatNaira(result.cost_per_plate_kobo)}</span>
          </div>
        </div>

        <label
          htmlFor="margin"
          style={{ display: "block", fontSize: 14, fontWeight: 600, color: C.text, marginTop: 20 }}
        >
          Target margin: {margin}%
        </label>
        <input
          id="margin"
          className="np-slider"
          type="range"
          min={0}
          max={90}
          step={1}
          value={margin}
          onChange={(e) => onMarginChange(Number(e.target.value))}
          style={{ width: "100%", marginTop: 10, background: `linear-gradient(to right, ${C.blue} ${(margin / 90) * 100}%, ${C.border} ${(margin / 90) * 100}%)` }}
        />

        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.muted }}>Suggested selling price</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.navy }}>
            {formatNaira(result.suggested_price_kobo)}
          </div>
        </div>

        {calloutOpen && (
          <div
            role="note"
            style={{
              marginTop: 20,
              border: `1px solid ${C.success}`,
              borderRadius: 8,
              padding: "12px 40px 12px 16px",
              position: "relative",
              background: C.white,
            }}
          >
            <span style={{ fontSize: 14, color: C.text, lineHeight: 1.5, display: "block" }}>
              This math is simple. Remembering to redo it every time garri or egusi changes price — for every dish
              you sell — is the part that actually saves you money.
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setCalloutOpen(false)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "transparent",
                border: "none",
                color: C.muted,
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
      <div style={{ textAlign: "center", marginTop: 24 }}>
        <OutlineLink to="/signup">Try it with your own ingredients</OutlineLink>
      </div>
    </Section>
  );
}

const TRIAL_POINTS = [
  "14 days free, full access, every feature.",
  "We help you set up your top 5 dishes and market-unit conversions so you're not starting from a blank screen.",
  "Daily WhatsApp summaries of your sales and profit during the trial, so you see the value before you're asked to pay.",
];

function TrialOffer() {
  return (
    <Section bg={C.navy}>
      <Heading onNavy>14 Days Free, With a Real Person Setting It Up For You.</Heading>
      <div style={{ display: "grid", gap: 12, marginTop: 24, maxWidth: 720 }}>
        {TRIAL_POINTS.map((t) => (
          <div key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <Check size={22} color={C.success} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ color: C.onNavy, fontSize: 16, lineHeight: 1.6 }}>{t}</span>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", marginTop: 32 }}>
        <PrimaryLink to="/signup">Start Your Free Trial</PrimaryLink>
      </div>
    </Section>
  );
}

function WhatsAppSection() {
  return (
    <Section bg={C.light}>
      <div style={{ textAlign: "center" }}>
        <WhatsAppButton large />
      </div>
    </Section>
  );
}
