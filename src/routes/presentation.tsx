import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, LogOut, Maximize2, Minimize2, Pause, Play, RotateCcw,
} from "lucide-react";

import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { CAPTIONS, SCREEN_TITLES } from "@/components/presentation/data";
import {
  CalculatorScreen, DashboardScreen, EndCardScreen, IngredientsScreen,
  LoginGateScreen, PnlScreen, PricingReviewScreen,
} from "@/components/presentation/screens";

export const Route = createFileRoute("/presentation")({
  head: () => ({
    meta: [
      { title: "NairaPlate — Product walkthrough" },
      {
        name: "description",
        content:
          "A full-screen walkthrough of NairaPlate: staff PIN sign-in, market-unit plate costing, pricing alerts and daily profit.",
      },
      { property: "og:title", content: "NairaPlate — Product walkthrough" },
      {
        property: "og:description",
        content: "See how NairaPlate costs every plate in real market units and protects your margins.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PresentationPage,
});

const STEP_MS = 11000;
const TOTAL = 7;

function PresentationPage() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const go = useCallback((next: number) => {
    setStep(Math.min(TOTAL - 1, Math.max(0, next)));
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      setStep((s) => (s + 1 >= TOTAL ? (setPlaying(false), s) : s + 1));
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") { setPlaying(false); go(step + 1); }
      if (e.key === "ArrowLeft") { setPlaying(false); go(step - 1); }
      if (e.key.toLowerCase() === "f") void toggleFullscreen();
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function toggleFullscreen() {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setFullscreen(true);
      } else {
        await document.exitFullscreen();
        setFullscreen(false);
      }
    } catch {
      setFullscreen(Boolean(document.fullscreenElement));
    }
  }

  const screens = [
    <LoginGateScreen key="s1" />,
    <DashboardScreen key="s2" />,
    <IngredientsScreen key="s3" />,
    <CalculatorScreen key="s4" />,
    <PricingReviewScreen key="s5" />,
    <PnlScreen key="s6" />,
    <EndCardScreen key="s7" onReplay={() => { setStep(0); setPlaying(true); }} />,
  ];

  return (
    <div
      ref={shellRef}
      className="flex min-h-screen flex-col bg-pres-navy-deep font-sans text-white"
    >
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-pres-navy/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Logo size={30} variant="white" layout="inline" className="text-base" />

          <div className="order-3 flex w-full items-center justify-center gap-1.5 sm:order-2 sm:w-auto sm:flex-1">
            <button
              type="button"
              onClick={() => { setPlaying(false); go(step - 1); }}
              disabled={step === 0}
              aria-label="Previous screen"
              className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            {SCREEN_TITLES.map((title, i) => (
              <button
                key={title}
                type="button"
                title={title}
                aria-label={`Go to ${title}`}
                onClick={() => { setPlaying(false); go(i); }}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-8 bg-pres-blue" : "w-4 bg-white/25 hover:bg-white/50",
                )}
              />
            ))}
            <button
              type="button"
              onClick={() => { setPlaying(false); go(step + 1); }}
              disabled={step === TOTAL - 1}
              aria-label="Next screen"
              className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause tour" : "Play tour"}
              className="ml-1 rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
          </div>

          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
            <span className="hidden rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 sm:inline">
              Mama Tolu · Owner
            </span>
            <button
              type="button"
              onClick={() => { setStep(0); setPlaying(false); }}
              aria-label="Restart walkthrough"
              className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <RotateCcw className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label="Toggle full screen"
              className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button
              type="button"
              aria-label="Log out"
              className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ---------- stage ---------- */}
      <main className="relative flex flex-1 items-center justify-center px-4 py-8 pb-28 sm:px-6 sm:py-12 sm:pb-32">
        <div
          key={step}
          className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          {screens[step]}
        </div>
      </main>

      {/* ---------- bottom caption banner ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-pres-blue/70 bg-pres-navy/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-4 sm:py-5">
          <span className="hidden shrink-0 rounded-full bg-pres-blue px-2.5 py-1 text-[11px] font-bold text-white sm:inline">
            {step + 1} / {TOTAL}
          </span>
          <p
            key={`cap-${step}`}
            className="animate-in fade-in slide-in-from-left-2 text-base font-bold leading-snug text-white duration-500 sm:text-xl"
          >
            {CAPTIONS[step]}
          </p>
        </div>
      </div>
    </div>
  );
}
