import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Register your business — NairaPlate" },
      { name: "description", content: "Sign your food business up for NairaPlate. Your account opens once it's approved." },
      { property: "og:title", content: "Register your business — NairaPlate" },
      { property: "og:description", content: "Sign your food business up for NairaPlate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Signup,
});

const ENDPOINT = "/api/public/business-signup";
async function call(body: unknown) {
  const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

type CodeState = { state: "idle" | "checking" | "ok" | "bad"; text?: string };

function Signup() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [owner, setOwner] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [contact, setContact] = useState("");
  const [codeState, setCodeState] = useState<CodeState>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Live availability check as they type (waits 400 ms after the last key).
  useEffect(() => {
    const c = code.trim().toLowerCase();
    if (!c) return setCodeState({ state: "idle" });
    setCodeState({ state: "checking" });
    const t = setTimeout(async () => {
      const { data } = await call({ action: "check_code", business_id: c });
      if (data.error) setCodeState({ state: "bad", text: data.error });
      else setCodeState(data.available ? { state: "ok", text: "Available" } : { state: "bad", text: "That code is taken — try another." });
    }, 400);
    return () => clearTimeout(t);
  }, [code]);

  const pinOk = /^\d{4,8}$/.test(pin) && pin === pin2;
  const canSubmit = name.trim().length >= 2 && owner.trim() && contact.trim().length >= 5 && pinOk && codeState.state === "ok" && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(null);
    const { data } = await call({ action: "signup", business_id: code.trim().toLowerCase(), name, owner_name: owner, pin, contact });
    setBusy(false);
    if (data.ok) setDone(true);
    else setError(data.error ?? "Could not register.");
  }

  if (done)
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-4">
          <h1 className="text-3xl font-semibold text-foreground">Thank you</h1>
          <p className="text-foreground">Your business is pending approval. You'll be able to sign in once it's approved.</p>
          <p className="text-sm text-muted-foreground">Your business code is <strong>{code.trim().toLowerCase()}</strong>. Keep it — you'll need it with your PIN to sign in.</p>
          <Link className="text-sm underline" to="/">Back to sign in</Link>
        </div>
      </main>
    );

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md space-y-4">
        <h1 className="text-3xl font-semibold text-foreground">Register your business</h1>
        <p className="text-muted-foreground">We'll check your details, then switch your account on.</p>
        <div className="space-y-1"><Label htmlFor="bn">Business name</Label>
          <Input id="bn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mama Put Kitchen" /></div>
        <div className="space-y-1"><Label htmlFor="bc">Business code (what your staff type to sign in)</Label>
          <Input id="bc" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s+/g, "-"))} placeholder="mama-put" />
          {codeState.state === "checking" && <p className="text-xs text-muted-foreground">Checking…</p>}
          {codeState.state === "ok" && <p className="text-xs text-primary">{codeState.text}</p>}
          {codeState.state === "bad" && <p className="text-xs text-destructive">{codeState.text}</p>}
        </div>
        <div className="space-y-1"><Label htmlFor="on">Your name</Label>
          <Input id="on" value={owner} onChange={(e) => setOwner(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor="p1">Your PIN (4–8 digits)</Label>
            <Input id="p1" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
          <div className="space-y-1"><Label htmlFor="p2">PIN again</Label>
            <Input id="p2" type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
        </div>
        {pin2 && pin !== pin2 && <p className="text-xs text-destructive">The two PINs don't match.</p>}
        <div className="space-y-1"><Label htmlFor="ct">Your phone or email</Label>
          <Input id="ct" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="0803 000 0000" /></div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={!canSubmit}>{busy ? "Sending…" : "Register business"}</Button>
        <Link className="block text-center text-sm underline" to="/">Already registered? Sign in</Link>
      </form>
    </main>
  );
}
