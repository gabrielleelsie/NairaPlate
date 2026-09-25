import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/staff")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Staff — NairaPlate" },
      { name: "description", content: "Owners add staff, reset PINs and deactivate accounts in NairaPlate." },
      { property: "og:title", content: "Staff — NairaPlate" },
      { property: "og:description", content: "Owners add staff, reset PINs and deactivate accounts in NairaPlate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StaffScreen,
});

// Random 6-digit PIN (100000–999999), so the owner doesn't have to think one up.
function generatePin() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

// Stored value (exact staff_users.role CHECK value) -> display label. Order is fixed.
const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "purchaser", label: "Purchaser" },
  { value: "cook", label: "Kitchen Staff" },
  { value: "cashier", label: "Cashier" },
  { value: "supa_admin", label: "Supa Admin" },
] as const;
type RoleValue = (typeof ROLE_OPTIONS)[number]["value"];
const roleLabel = (v: string) => ROLE_OPTIONS.find((r) => r.value === v)?.label ?? v;

type StaffRow = { id: string; display_name: string; role: string; is_active: boolean };

async function callAdmin(body: unknown) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch("/api/public/staff-admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function StaffScreen() {
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [myId, setMyId] = useState("");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [filter, setFilter] = useState<"all" | RoleValue>("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Frontend route guard: owner or supa_admin only (the server re-checks every call).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const role = data.user?.app_metadata?.["role"];
      if (data.user && (role === "owner" || role === "supa_admin")) {
        setMyId(data.user.id);
        setAccess("allowed");
      } else setAccess("denied");
    });
  }, []);

  const load = useCallback(async () => {
    const { status, data } = await callAdmin({ action: "list_staff" });
    if (status !== 200) return setError(data.error ?? "Could not load staff.");
    setStaff(data.staff ?? []);
  }, []);

  useEffect(() => {
    if (access === "allowed") load();
  }, [access, load]);

  if (access === "checking") return <Shell><p className="text-muted-foreground">Checking access…</p></Shell>;
  if (access === "denied") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-foreground">Owners only</h1>
        <p className="mt-2 text-muted-foreground">Sign in as an owner to manage staff.</p>
        <Link to="/" className="mt-6 inline-block text-sm underline text-muted-foreground">Go to sign-in</Link>
      </Shell>
    );
  }

  const shown = filter === "all" ? staff : staff.filter((s) => s.role === filter);

  return (
    <Shell>
      <Link to="/" className="text-sm text-muted-foreground underline">← Back</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Staff</h1>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {notice && <p className="mt-3 text-sm text-foreground">{notice}</p>}

      <AddStaffForm
        onDone={(msg) => {
          setError(null);
          setNotice(msg);
          load();
        }}
        onError={(m) => { setNotice(null); setError(m); }}
      />

      <div className="mt-8 flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-foreground">Current staff</h2>
        <Select value={filter} onValueChange={(v) => setFilter(v as "all" | RoleValue)}>
          <SelectTrigger className="w-44" aria-label="Filter by role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {shown.length === 0 && <li className="p-4 text-sm text-muted-foreground">No staff yet.</li>}
        {shown.map((s) => (
          <StaffItem
            key={s.id}
            s={s}
            isMe={s.id === myId}
            onDone={(msg) => { setError(null); setNotice(msg); load(); }}
            onError={(m) => { setNotice(null); setError(m); }}
          />
        ))}
      </ul>
    </Shell>
  );
}

function AddStaffForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<RoleValue | "">("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || !role || !/^\d{4,8}$/.test(pin)) {
          return onError("Enter a name, pick a role, and a 4–8 digit PIN.");
        }
        setBusy(true);
        const { status, data } = await callAdmin({ action: "create_staff", display_name: name.trim(), role, pin });
        setBusy(false);
        if (status !== 200) return onError(data.error ?? "Could not add staff member.");
        setName(""); setRole(""); setPin("");
        onDone(`${data.staff.display_name} added.`);
      }}
    >
      <h2 className="text-lg font-medium text-card-foreground">Add staff member</h2>
      <div className="grid gap-2">
        <Label htmlFor="new-name">Name</Label>
        <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </div>
      <div className="grid gap-2">
        <Label>Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v as RoleValue)}>
          <SelectTrigger aria-label="Role"><SelectValue placeholder="Pick a role" /></SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="new-pin">Starting PIN (4–8 digits)</Label>
        <div className="flex gap-2">
          <Input
            id="new-pin"
            inputMode="numeric"
            type={pinRevealed ? "text" : "password"}
            value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinRevealed(false); }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => { setPin(generatePin()); setPinRevealed(true); }}
          >
            Generate
          </Button>
        </div>
        {pinRevealed && pin && (
          <p className="text-sm text-muted-foreground">
            PIN: <span className="font-mono font-semibold text-foreground">{pin}</span> — tell {name.trim() || "them"} this PIN. It won't be shown again.
          </p>
        )}
      </div>
      <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add staff member"}</Button>
    </form>
  );
}

function StaffItem({
  s, isMe, onDone, onError,
}: { s: StaffRow; isMe: boolean; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [resetting, setResetting] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-foreground">
            {s.display_name} {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
          </div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {roleLabel(s.role)} · {s.is_active ? "Active" : "Deactivated"}
          </div>
        </div>
        {s.is_active && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setResetting((v) => !v)}>Reset PIN</Button>
            {!isMe && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Deactivate ${s.display_name}? They won't be able to sign in.`)) return;
                  setBusy(true);
                  const { status, data } = await callAdmin({ action: "deactivate_staff", staff_id: s.id });
                  setBusy(false);
                  if (status !== 200) return onError(data.error ?? "Could not deactivate.");
                  onDone(`${s.display_name} deactivated.`);
                }}
              >
                Deactivate
              </Button>
            )}
          </div>
        )}
      </div>
      {resetting && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!/^\d{4,8}$/.test(pin)) return onError("PIN must be 4–8 digits.");
            setBusy(true);
            const { status, data } = await callAdmin({ action: "reset_pin", staff_id: s.id, pin });
            setBusy(false);
            if (status !== 200) return onError(data.error ?? "Could not reset PIN.");
            setPin(""); setResetting(false);
            onDone(`New PIN set for ${s.display_name}.`);
          }}
        >
          <Input
            aria-label="New PIN"
            placeholder="New PIN"
            inputMode="numeric"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <Button type="submit" size="sm" disabled={busy}>Save</Button>
        </form>
      )}
    </li>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-xl">{children}</div>
    </main>
  );
}
