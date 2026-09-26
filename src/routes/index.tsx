import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import {
  AlertTriangle, BarChart3, BookOpen, CalendarDays, ChefHat, ClipboardList,
  CreditCard, HandCoins, History, Landmark, LogOut, PackageSearch, ReceiptText,
  Scale, ShoppingBasket, Store, Truck, Users, UtensilsCrossed, WalletCards,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NairaPlate — Staff sign-in" },
      { name: "description", content: "Pick your name and enter your PIN to start your NairaPlate shift." },
      { property: "og:title", content: "NairaPlate — Staff sign-in" },
      { property: "og:description", content: "Pick your name and enter your PIN to start your NairaPlate shift." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginScreen,
});

// Only these four fields ever reach the browser.
type StaffOption = { id: string; display_name: string; role: string; is_active: boolean };

const ENDPOINT = "/api/public/staff-pin-login";
const BUSINESS_KEY = "nairaplate.business_id";

async function callEndpoint(body: unknown) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function LoginScreen() {
  const [businessId, setBusinessId] = useState("");
  const [businessInput, setBusinessInput] = useState("");
  const [staff, setStaff] = useState<StaffOption[] | null>(null);
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);

  useEffect(() => {
    if (!signedInAs) return setMyRole(null);
    supabase.auth.getUser().then(({ data }) => setMyRole((data.user?.app_metadata?.["role"] as string) ?? null));
  }, [signedInAs]);

  useEffect(() => {
    const saved = localStorage.getItem(BUSINESS_KEY);
    if (saved) setBusinessId(saved);
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setSignedInAs((data.user.user_metadata?.["display_name"] as string) ?? "staff");
    });
  }, []);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    callEndpoint({ action: "list_staff", business_id: businessId })
      .then(({ status, data }) => {
        if (status !== 200) throw new Error(data.error ?? "Could not load staff.");
        const list: StaffOption[] = (data.staff ?? []).map((s: StaffOption) => ({
          id: s.id,
          display_name: s.display_name,
          role: s.role,
          is_active: s.is_active,
        }));
        setStaff(list);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [businessId]);

  if (signedInAs) {
    return <HomeScreen name={signedInAs} role={myRole} onSignOut={async () => {
      await supabase.auth.signOut();
      setSignedInAs(null);
      setSelected(null);
    }} />;
  }

  if (!businessId) {
    return (
      <AuthShell>
        <h1 className="text-3xl font-semibold text-foreground">NairaPlate</h1>
        <p className="mt-2 text-muted-foreground">Enter your business code to begin.</p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = businessInput.trim();
            if (!v) return;
            localStorage.setItem(BUSINESS_KEY, v);
            setBusinessId(v);
          }}
        >
          <Input value={businessInput} onChange={(e) => setBusinessInput(e.target.value)} placeholder="Business code" />
          <Button type="submit" className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90">Continue</Button>
        </form>
        <Link className="mt-6 block text-center text-sm font-medium text-brand-blue underline underline-offset-4" to="/signup">New here? Register your business</Link>
      </AuthShell>
    );
  }

  if (selected) {
    return (
      <PinScreen
        businessId={businessId}
        staff={selected}
        onBack={() => setSelected(null)}
        onSignedIn={(name) => setSignedInAs(name)}
      />
    );
  }

  return (
    <AuthShell>
      <h1 className="text-3xl font-semibold text-foreground">Who's working?</h1>
      <p className="mt-2 text-muted-foreground">Tap your name.</p>
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      {loading && <p className="mt-6 text-muted-foreground">Loading staff…</p>}
      {staff && staff.length === 0 && !loading && (
        <p className="mt-6 text-muted-foreground">No active staff found for this business.</p>
      )}
      <div className="mt-6 grid grid-cols-2 gap-3">
        {staff?.map((s) => (
          <Button
            key={s.id}
            type="button"
            variant="outline"
            onClick={() => setSelected(s)}
            className="h-auto min-h-20 flex-col items-start gap-1 whitespace-normal border-border bg-card p-4 text-left hover:border-brand-blue hover:bg-accent focus-visible:ring-brand-blue"
          >
            <div className="font-medium text-card-foreground">{s.display_name}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.role.replace("_", " ")}</div>
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="link"
        className="mt-6 h-auto px-0 text-muted-foreground"
        onClick={() => {
          localStorage.removeItem(BUSINESS_KEY);
          setBusinessId("");
          setStaff(null);
        }}
      >
        Change business
      </Button>
    </AuthShell>
  );
}

function PinScreen({
  businessId,
  staff,
  onBack,
  onSignedIn,
}: {
  businessId: string;
  staff: StaffOption;
  onBack: () => void;
  onSignedIn: (name: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const t = setTimeout(() => setLockSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lockSeconds]);

  async function submit() {
    if (pin.length < 4 || busy || lockSeconds > 0) return;
    setBusy(true);
    setError(null);
    const { status, data } = await callEndpoint({ business_id: businessId, staff_id: staff.id, pin });
    setPin("");
    if (status === 200 && data.session) {
      const { error: sessErr } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      setBusy(false);
      if (sessErr) return setError("Could not start your session.");
      onSignedIn(staff.display_name);
      return;
    }
    setBusy(false);
    if (status === 429 && typeof data.remaining_seconds === "number") setLockSeconds(data.remaining_seconds);
    setError(data.error ?? "Sign-in failed.");
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <AuthShell>
      <Button type="button" variant="ghost" onClick={onBack} className="h-auto px-0 text-sm text-muted-foreground"><ArrowBack /> Back</Button>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">{staff.display_name}</h1>
      <p className="mt-1 text-muted-foreground">Enter your PIN</p>
      <div className="mt-6 flex justify-center gap-3">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border border-foreground ${i < pin.length ? "bg-foreground" : ""}`} />
        ))}
      </div>
      {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}
      {lockSeconds > 0 && <p className="mt-1 text-center text-sm text-muted-foreground">Locked for {lockSeconds}s</p>}
      <div className="mx-auto mt-6 grid max-w-xs grid-cols-3 gap-3">
        {keys.map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : (
            <Button
              key={i}
              variant="outline"
               className="h-16 border-brand-blue/30 text-xl text-brand-navy hover:border-brand-blue hover:bg-brand-blue hover:text-brand-inverse focus-visible:ring-brand-blue"
              disabled={busy || lockSeconds > 0}
              onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 8 ? p + k : p)))}
            >
              {k}
            </Button>
          ),
        )}
      </div>
       <Button className="mx-auto mt-6 block w-full max-w-xs bg-brand-blue text-brand-inverse hover:bg-brand-blue/90" disabled={pin.length < 4 || busy || lockSeconds > 0} onClick={submit}>
        {busy ? "Checking…" : "Sign in"}
      </Button>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-brand-navy px-4 py-8 sm:py-12">
      <Logo layout="stacked" variant="white" size={72} className="mb-6 sm:mb-8" />
      <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-auth sm:p-8">{children}</div>
    </main>
  );
}

function ArrowBack() {
  return <span aria-hidden="true">←</span>;
}

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner", supa_admin: "Supa Admin", cashier: "Cashier", purchaser: "Purchaser",
  cook: "Kitchen Staff", platform_admin: "Platform Admin",
};

type AppLink = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };
const SELL: AppLink[] = [
  { to: "/pos", label: "Till", icon: Store },
  { to: "/drawer", label: "Cash drawer", icon: WalletCards },
  { to: "/orders", label: "Orders", icon: ReceiptText },
  { to: "/credit", label: "Customer credit", icon: CreditCard },
  { to: "/catering", label: "Catering", icon: CalendarDays },
];
const STOCK: AppLink[] = [
  { to: "/purchases", label: "Purchases", icon: ShoppingBasket },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/shopping-list", label: "Shopping list", icon: ClipboardList },
  { to: "/ingredients", label: "Ingredients", icon: PackageSearch },
];
const KITCHEN: AppLink[] = [
  { to: "/recipes", label: "Recipes", icon: BookOpen },
  { to: "/batches", label: "Log a batch", icon: ChefHat },
  { to: "/wastage", label: "Wastage", icon: UtensilsCrossed },
];
const OVERSIGHT: AppLink[] = [
  { to: "/dashboard", label: "P&L", icon: BarChart3 },
  { to: "/cashflow", label: "7-day cashflow", icon: Landmark },
  { to: "/flags", label: "Alerts", icon: AlertTriangle },
  { to: "/audit", label: "Audit log", icon: History },
  { to: "/payouts", label: "Channel payouts", icon: HandCoins },
  { to: "/recipes", label: "Pricing review", icon: Scale },
  { to: "/staff", label: "Staff", icon: Users },
  { to: "/report", label: "Print report", icon: ClipboardList },
];

function HomeScreen({ name, role, onSignOut }: { name: string; role: string | null; onSignOut: () => Promise<void> }) {
  const isOwner = role === "owner" || role === "supa_admin";
  const groups = role === "platform_admin"
    ? [{ title: "Platform", links: [
        { to: "/approvals", label: "Business approvals", icon: ClipboardList },
        { to: "/approvals", label: "All businesses", icon: Store },
        { to: "/approvals", label: "Troubleshoot", icon: LifeBuoy },
      ] }]
    : [
        ...(role === "cashier" || isOwner ? [{ title: "Sell", links: SELL }] : []),
        ...(role === "purchaser" || isOwner ? [{ title: "Buy & Stock", links: STOCK }] : []),
        ...(role === "cook" || isOwner ? [{ title: "Kitchen", links: KITCHEN }] : []),
        ...(isOwner ? [{ title: "Oversight", links: OVERSIGHT }] : []),
      ];

  return (
    <main className="min-h-dvh bg-home-surface">
      <header className="bg-brand-navy text-brand-inverse">
        <div className="mx-auto grid min-h-20 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-5 px-4 sm:gap-8 sm:px-6">
          <Logo variant="white" layout="inline" size={38} className="min-w-0" />
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 truncate text-right text-sm font-semibold">
              {name} <span className="font-normal text-brand-inverse/60">·</span> {ROLE_NAMES[role ?? ""] ?? role ?? "Staff"}
            </div>
            <Button type="button" variant="ghost" size="icon" className="shrink-0 text-brand-inverse hover:bg-brand-inverse/10 hover:text-brand-inverse" onClick={onSignOut} title="Sign out" aria-label="Sign out">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-9 px-4 py-7 sm:px-6 sm:py-10">
        {groups.map((group) => <ActionGroup key={group.title} title={group.title} links={group.links} />)}
      </div>
    </main>
  );
}

function ActionGroup({ title, links }: { title: string; links: AppLink[] }) {
  return (
    <section aria-labelledby={`group-${title.replace(/\W/g, "-")}`}>
      <h2 id={`group-${title.replace(/\W/g, "-")}`} className="mb-3 text-sm font-semibold uppercase tracking-normal text-brand-navy/70">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {links.map(({ to, label, icon: Icon }) => (
          <Button key={`${to}-${label}`} asChild variant="outline" className="h-24 w-full flex-col gap-2 whitespace-normal border-border bg-card px-2 text-center text-brand-navy shadow-xs hover:border-brand-blue hover:bg-card hover:text-brand-navy focus-visible:ring-brand-blue">
            <Link to={to}><Icon className="text-brand-blue" /><span className="text-sm font-semibold leading-tight">{label}</span></Link>
          </Button>
        ))}
      </div>
    </section>
  );
}
