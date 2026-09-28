import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Check, Plus, Share, ShieldCheck, Scale, Bell, Wallet, X } from "lucide-react";

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
const MEDIA_PATH = "/api/public/media";

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
function useEbaEgusi(marginPct: number, garriSpikePct = 0) {
  return useMemo(
    () =>
      computeRecipeCost({
        items: EBA_EGUSI_ITEMS,
        ingredients: DEMO_INGREDIENTS.map((i) =>
          i.id === "garri"
            ? { ...i, current_cost_kobo: Math.round(i.current_cost_kobo * (1 + garriSpikePct / 100)) }
            : i,
        ),
        conversions: DEMO_CONVERSIONS,
        yield_portions: EBA_EGUSI_PLATES,
        target_margin_bps: Math.round(marginPct * 100),
      }),
    [marginPct, garriSpikePct],
  );
}

function MarketingPage() {
  return (
    <div style={{ fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <SiteHeader />
      <main>
        <Hero />
        <LiveCalculator />
        <DemoVideos />
        <Features />
        <WhoItsFor />
        <InstallGuide />
        <TrialOffer />
        <WhatsAppSection />
      </main>
      <SiteFooter />
      <FloatingWhatsApp />
    </div>
  );
}

const AUDIENCES = [
  "Bukas & mama-put kitchens",
  "Bakeries & pastry shops",
  "Event caterers",
  "Cloud kitchens on delivery apps",
  "Quick-service restaurants",
];

function WhoItsFor() {
  return (
    <Section bg={C.white}>
      <Heading>Made for Every Nigerian Food Business That Sells by the Plate.</Heading>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
        {AUDIENCES.map((a) => (
          <span
            key={a}
            style={{
              border: `1px solid ${C.blue}`,
              color: C.navy,
              borderRadius: 999,
              padding: "10px 18px",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            {a}
          </span>
        ))}
      </div>
    </Section>
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
            Know What Every Plate Really Costs — Before Market Prices Eat Your Profit.
          </h1>
          <p
            className="np-sub"
            style={{ color: C.onNavy, fontWeight: 400, lineHeight: 1.5, maxWidth: 640, marginTop: 20 }}
          >
            NairaPlate's live plate calculator turns today's market prices — in mudu, paint rubber and derica — into
            the true cost of every dish and the price you should charge. When garri or pepper jumps, it tells you
            which dishes are losing money.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 32 }}>
            <PrimaryLink to="/signup">Start 14-Day Free Trial</PrimaryLink>
            <SecondaryButton
              onClick={() => document.getElementById("calculator")?.scrollIntoView({ behavior: "smooth" })}
            >
              Try the Calculator
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

const SITE_URL = "https://nairaplate.com";

// Encoded once at module load — the QR never changes, so no React state or hooks are needed.
const QR_MODULES = (() => {
  try {
    return QRCode.create(SITE_URL, { errorCorrectionLevel: "M" }).modules;
  } catch {
    return null;
  }
})();

function QrCode() {
  if (!QR_MODULES) return null;
  const { size, data } = QR_MODULES;
  const rects: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) rects.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      width={176}
      height={176}
      role="img"
      aria-label="QR code linking to nairaplate.com"
    >
      <rect width={size} height={size} fill={C.white} />
      <path d={rects.join("")} fill={C.navy} />
    </svg>
  );
}

function InstallGuide() {
  const [platform, setPlatform] = useState<"android" | "ios" | "desktop">("desktop");
  const [tab, setTab] = useState<"android" | "ios">("android");
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
      setTab("android");
      if (/SamsungBrowser/i.test(ua)) setAndroidBrowser("samsung");
    } else if (/iPad|iPhone|iPod/.test(ua)) {
      setPlatform("ios");
      setTab("ios");
    } else {
      setPlatform("desktop");
    }

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

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "12px 10px",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    border: `2px solid ${C.blue}`,
    background: active ? C.blue : "transparent",
    color: active ? C.white : C.blue,
  });

  return (
    <Section bg={C.light} id="download">
      <Heading>Install NairaPlate on Your Phone.</Heading>
      <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.6, margin: "16px 0 0", maxWidth: 640 }}>
        NairaPlate runs like any other app on Android and iPhone — tap the icon on your home screen and it opens
        straight into your kitchen. No app store, no download size, no updates to wait for.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 32, marginTop: 32, alignItems: "stretch" }}>
        {platform === "desktop" && (
          <div
            style={{
              ...cardStyle,
              flex: "0 1 300px",
              display: "grid",
              justifyItems: "center",
              alignContent: "start",
              gap: 16,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: C.navy }}>Reading this on a computer?</div>
            <div style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white }}>
              <QRCodeSVG value={SITE_URL} size={176} bgColor={C.white} fgColor={C.navy} level="M" />
            </div>
            <p style={{ fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.5 }}>
              Scan this with your phone camera to open NairaPlate, then follow the steps here to add it to your
              home screen.
            </p>
          </div>
        )}

        <div style={{ ...cardStyle, flex: "1 1 380px", minWidth: 300, maxWidth: 560 }}>
          <div role="tablist" aria-label="Choose your phone type" style={{ display: "flex", gap: 8 }}>
            <button type="button" role="tab" aria-selected={tab === "android"} onClick={() => setTab("android")} style={tabButtonStyle(tab === "android")}>
              Android (Chrome &amp; Samsung)
            </button>
            <button type="button" role="tab" aria-selected={tab === "ios"} onClick={() => setTab("ios")} style={tabButtonStyle(tab === "ios")}>
              iPhone (Safari)
            </button>
          </div>

          {tab === "android" && (
            <div role="tabpanel" style={{ marginTop: 24 }}>
              <p style={{ fontSize: 16, color: C.text, lineHeight: 1.6, marginTop: 0 }}>
                Add NairaPlate to your Android home screen.
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
            </div>
          )}

          {tab === "ios" && (
            <div role="tabpanel" style={{ marginTop: 24, display: "grid", gap: 16, textAlign: "left" }}>
              <p style={{ fontSize: 16, color: C.text, lineHeight: 1.6, margin: 0 }}>
                Add NairaPlate to your iPhone home screen using Safari:
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <Share size={32} color={C.blue} />
                <span style={{ fontSize: 16, color: C.text }}>1. Open nairaplate.com in Safari and tap the <strong>Share</strong> icon (the square with an arrow)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <Plus size={32} color={C.blue} />
                <span style={{ fontSize: 16, color: C.text }}>2. Scroll down and tap <strong>'Add to Home Screen'</strong></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <Check size={32} color={C.blue} />
                <span style={{ fontSize: 16, color: C.text }}>3. Tap <strong>Add</strong> — the NairaPlate icon appears on your home screen</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

const FEATURES = [
  {
    icon: Scale,
    title: "Buying: Real Prices In, Real Units.",
    body:
      "Log purchases in 18 Nigerian market units — mudu, paint rubber, basin, jerry can. Every purchase updates ingredient prices, so the calculator always uses today's cost.",
  },
  {
    icon: Bell,
    title: "Kitchen: The Margin Alarm.",
    body:
      "When an ingredient rises more than 5%, every dish using it is flagged for a pricing decision. Batches and wastage are logged so nothing hides in the pot.",
  },
  {
    icon: Wallet,
    title: "Selling: Every Naira Reconciled.",
    body:
      "Cashier POS with cash drawer counts, delivery-app payout checks, and voids kept on record with a reason — sales always match the plate cost behind them.",
  },
  {
    icon: ShieldCheck,
    title: "Oversight: Owner-Level Truth.",
    body:
      "Staff PINs limit what each role sees. Owners get the full P&L, 7-day cashflow and an audit log that can't be edited. Past sales keep their original recipe cost.",
  },
];

function Features() {
  return (
    <Section bg={C.light}>
      <Heading>The Whole Kitchen Keeps the Calculator Honest.</Heading>
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
      webm: `${MEDIA_PATH}/nairaplate-price-calculator-demo.webm`,
      mp4: `${MEDIA_PATH}/nairaplate-price-calculator-demo.mp4`,
      poster: `${MEDIA_PATH}/nairaplate-price-calculator-poster.jpg`,
      title: "The price calculator",
      caption:
        "Watch ingredient prices turn into the real cost of a dish — and the price you should charge to protect your margin.",
      featured: true,
    },
    {
      webm: `${MEDIA_PATH}/nairaplate-walkthrough.webm`,
      mp4: `${MEDIA_PATH}/nairaplate-walkthrough.mp4`,
      poster: `${MEDIA_PATH}/nairaplate-walkthrough-poster.jpg`,
      title: "NairaPlate in action",
      caption:
        "A full walkthrough of the app — live costing, margin pricing, purchase logging, and the owner dashboard.",
    },
    {
      webm: `${MEDIA_PATH}/nairaplate-admin-demo.webm`,
      mp4: `${MEDIA_PATH}/nairaplate-admin-demo.mp4`,
      poster: `${MEDIA_PATH}/nairaplate-admin-poster.jpg`,
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
            key={v.mp4}
            className={v.featured ? "np-video-featured" : undefined}
            style={v.featured ? { gridColumn: "1 / -1", margin: 0 } : { margin: 0 }}
          >
            <div style={{ ...cardStyle, overflow: "hidden", padding: 0 }}>
              <video
                controls
                playsInline
                preload="metadata"
                poster={v.poster}
                style={{ display: "block", width: "100%", aspectRatio: "16 / 9", background: C.navy }}
              >
                <source src={v.webm} type="video/webm" />
                <source src={v.mp4} type="video/mp4" />
                Your browser cannot play this video.
              </video>
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
  const [spike, setSpike] = useState(false);
  const result = useEbaEgusi(margin);
  const spiked = useEbaEgusi(margin, 20);

  const onMarginChange = (value: number) => {
    setMargin(value);
    if (!touched) {
      setTouched(true);
      setCalloutOpen(true);
    }
  };

  return (
    <Section bg={C.white} id="calculator">
      <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, letterSpacing: 1, textAlign: "center", marginBottom: 8 }}>
        THE NAIRAPLATE PLATE CALCULATOR
      </div>
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

        <button
          type="button"
          aria-pressed={spike}
          onClick={() => setSpike((s) => !s)}
          style={{
            marginTop: 20,
            width: "100%",
            padding: "12px 16px",
            borderRadius: 8,
            border: `1px solid ${C.blue}`,
            background: spike ? C.blue : C.white,
            color: spike ? C.white : C.blue,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {spike ? "Hide the price jump" : "What if garri goes up 20% at the market?"}
        </button>
        {spike && (
          <div style={{ marginTop: 12, padding: 16, borderRadius: 8, background: C.light, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.text }}>
              <span>New cost per plate</span>
              <strong style={{ color: C.navy }}>{formatNaira(spiked.cost_per_plate_kobo)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.text }}>
              <span>New price to keep {margin}% margin</span>
              <strong style={{ color: C.success }}>{formatNaira(spiked.suggested_price_kobo)}</strong>
            </div>
            <p style={{ fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.5 }}>
              Keep selling at {formatNaira(result.suggested_price_kobo)} and you quietly lose{" "}
              {formatNaira((spiked.suggested_price_kobo ?? 0) - (result.suggested_price_kobo ?? 0))} of margin on every plate. In
              the app, the Margin Alarm flags this the moment you log the new garri price.
            </p>
          </div>
        )}

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
