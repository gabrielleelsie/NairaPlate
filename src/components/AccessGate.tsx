// Checks the signed-in staff member's business access on page load, window focus and every 60s.
// Owners / supa admins of an ended plan see the locked screen; other staff are signed out.
// The database enforces the same rule; this is the friendly face of it.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/lib/external-supabase";
import { accessState } from "@/lib/subscription";
import { LockedScreen } from "@/components/LockedScreen";
import { bannerWhen, renderTemplate } from "@/lib/platform-settings";
import { usePublicSettings } from "@/lib/use-public-settings";
import { Button } from "@/components/ui/button";

const PUBLIC_PATHS = new Set(["/", "/our-story", "/contact", "/signup", "/presentation", "/faq", "/resources", "/approvals"]);

type Gate =
  | { kind: "open" }
  | { kind: "warn"; daysLeft: number }
  | { kind: "locked"; name: string | null; endedAt: string | null }
  | { kind: "signed_out" };

export function AccessGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const skip = PUBLIC_PATHS.has(pathname);
  const [gate, setGate] = useState<Gate>({ kind: "open" });

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const u = data.session?.user;
    const businessId = u?.app_metadata?.["business_id"];
    const role = u?.app_metadata?.["role"];
    if (!u || typeof businessId !== "string" || role === "platform_admin") return setGate((g) => (g.kind === "signed_out" ? g : { kind: "open" }));
    const { data: biz, error } = await supabase.from("businesses")
      .select("name, status, plan, access_ends_at").eq("id", businessId).maybeSingle();
    if (error || !biz) return; // network hiccup: never lock on a failed read
    const state = accessState(biz as { status: string; access_ends_at: string | null; plan: string | null });
    const manager = role === "owner" || role === "supa_admin";
    if (state.kind === "expired") {
      if (manager) return setGate({ kind: "locked", name: biz.name ?? null, endedAt: biz.access_ends_at ?? null });
      await supabase.auth.signOut();
      return setGate({ kind: "signed_out" });
    }
    if (state.kind === "active" && manager && state.daysLeft <= 3) return setGate({ kind: "warn", daysLeft: state.daysLeft });
    setGate({ kind: "open" });
  }, []);

  useEffect(() => {
    if (skip) return;
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    const t = window.setInterval(check, 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(t); };
  }, [skip, pathname, check]);

  if (skip) return <>{children}</>;

  if (gate.kind === "locked") {
    return <LockedScreen businessName={gate.name} endedAt={gate.endedAt} onSignOut={async () => {
      await supabase.auth.signOut();
      window.location.href = "/app";
    }} />;
  }
  if (gate.kind === "signed_out") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-home-surface px-4">
        <div className="max-w-sm space-y-4 rounded-2xl bg-card p-6 text-center shadow-sm">
          <p className="font-medium text-foreground">Unable to sign in right now, contact your business owner</p>
          <Button onClick={() => { window.location.href = "/app"; }}>Back to sign-in</Button>
        </div>
      </main>
    );
  }
  return (
    <>
      {gate.kind === "warn" && (
        <ExpiryBanner daysLeft={gate.daysLeft} />
      )}
      {children}
    </>
  );
}

/** Fetches the admin's wording only when the banner is actually shown, so other pages make no extra request. */
function ExpiryBanner({ daysLeft }: { daysLeft: number }) {
  const { expiry_banner } = usePublicSettings();
  return (
    <div className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
      {renderTemplate(expiry_banner.text, { when: bannerWhen(daysLeft), days: String(daysLeft) })}
    </div>
  );
}
