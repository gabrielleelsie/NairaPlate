import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    return (
      <Shell>
        <h1 className="text-3xl font-semibold text-foreground">Welcome, {signedInAs}</h1>
        <p className="mt-2 text-muted-foreground">You are signed in.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/ingredients">Ingredients</Link></Button>
          <Button asChild variant="outline"><Link to="/recipes">Recipes</Link></Button>
          <Button asChild variant="outline"><Link to="/pos">Till</Link></Button>
        </div>
        {(myRole === "owner" || myRole === "supa_admin") && (
          <Button asChild className="mt-6 mr-2">
            <Link to="/staff">Manage staff</Link>
          </Button>
        )}
        <Button
          className="mt-6"
          variant="outline"
          onClick={async () => {
            await supabase.auth.signOut();
            setSignedInAs(null);
            setSelected(null);
          }}
        >
          Sign out
        </Button>
      </Shell>
    );
  }

  if (!businessId) {
    return (
      <Shell>
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
          <Button type="submit">Continue</Button>
        </form>
      </Shell>
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
    <Shell>
      <h1 className="text-3xl font-semibold text-foreground">Who's working?</h1>
      <p className="mt-2 text-muted-foreground">Tap your name.</p>
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      {loading && <p className="mt-6 text-muted-foreground">Loading staff…</p>}
      {staff && staff.length === 0 && !loading && (
        <p className="mt-6 text-muted-foreground">No active staff found for this business.</p>
      )}
      <div className="mt-6 grid grid-cols-2 gap-3">
        {staff?.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelected(s)}
            className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
          >
            <div className="font-medium text-card-foreground">{s.display_name}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.role.replace("_", " ")}</div>
          </button>
        ))}
      </div>
      <button
        className="mt-8 text-sm text-muted-foreground underline"
        onClick={() => {
          localStorage.removeItem(BUSINESS_KEY);
          setBusinessId("");
          setStaff(null);
        }}
      >
        Change business
      </button>
    </Shell>
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
    <Shell>
      <button onClick={onBack} className="text-sm text-muted-foreground underline">← Back</button>
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
              className="h-16 text-xl"
              disabled={busy || lockSeconds > 0}
              onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 8 ? p + k : p)))}
            >
              {k}
            </Button>
          ),
        )}
      </div>
      <Button className="mx-auto mt-6 block w-full max-w-xs" disabled={pin.length < 4 || busy || lockSeconds > 0} onClick={submit}>
        {busy ? "Checking…" : "Sign in"}
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
