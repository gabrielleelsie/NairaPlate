import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession, MARKET_UNITS, BASE_UNITS } from "@/lib/staff-session";
import { formatNaira, nairaToKobo, koboToNaira } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/ingredients")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ingredients — NairaPlate" },
      { name: "description", content: "Ingredient prices, stock thresholds and market-unit conversions for your kitchen." },
      { property: "og:title", content: "Ingredients — NairaPlate" },
      { property: "og:description", content: "Ingredient prices, stock thresholds and market-unit conversions for your kitchen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IngredientsScreen,
});

type Ingredient = {
  id: string; name: string; category: string | null; base_unit: string;
  current_cost_kobo: number; previous_cost_kobo: number; min_threshold_qty: number; supplier: string | null;
  price_updated_at: string | null;
};

function formatPriceDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
type Conversion = { id: string; ingredient_id: string; market_unit: string; base_qty: number };

const EDIT_ROLES = new Set(["owner", "supa_admin", "purchaser"]);

function IngredientsScreen() {
  const { loading, session } = useStaffSession();
  const [items, setItems] = useState<Ingredient[]>([]);
  const [convs, setConvs] = useState<Conversion[]>([]);
  const [editing, setEditing] = useState<Ingredient | "new" | null>(null);
  const [unitsFor, setUnitsFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from("ingredients").select("id,name,category,base_unit,current_cost_kobo,previous_cost_kobo,min_threshold_qty,supplier,price_updated_at").order("name"),
      supabase.from("unit_conversions").select("id,ingredient_id,market_unit,base_qty").order("market_unit"),
    ]);
    if (a.error || b.error) return setMsg({ ok: false, text: "Could not load ingredients." });
    setItems((a.data ?? []) as Ingredient[]);
    setConvs((b.data ?? []) as Conversion[]);
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/" className="underline text-sm">Go to sign-in</Link></Shell>;
  const canEdit = EDIT_ROLES.has(session.role);

  return (
    <Shell>
      <Link to="/" className="text-sm text-muted-foreground underline">← Home</Link>
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-3xl font-semibold text-foreground">Ingredients</h1>
        {canEdit && <Button onClick={() => setEditing("new")}>Add ingredient</Button>}
      </div>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-foreground" : "text-destructive"}`}>{msg.text}</p>}

      {editing && (
        <IngredientForm
          businessId={session.businessId}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(t) => { setEditing(null); setMsg({ ok: true, text: t }); load(); }}
          onError={(t) => setMsg({ ok: false, text: t })}
        />
      )}

      <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
        {items.length === 0 && <li className="p-4 text-sm text-muted-foreground">No ingredients yet.</li>}
        {items.map((i) => (
          <li key={i.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-foreground">{i.name}</div>
                <div className="text-sm text-muted-foreground">
                  {formatNaira(i.current_cost_kobo)} per {i.base_unit}
                  {i.previous_cost_kobo > 0 && i.previous_cost_kobo !== i.current_cost_kobo && (
                    <> · was {formatNaira(i.previous_cost_kobo)}</>
                  )}
                  {formatPriceDate(i.price_updated_at) && (
                    <> · price updated {formatPriceDate(i.price_updated_at)}</>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[i.category, i.supplier && `from ${i.supplier}`, `reorder below ${i.min_threshold_qty} ${i.base_unit}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setUnitsFor(unitsFor === i.id ? null : i.id)}>
                  Units ({convs.filter((c) => c.ingredient_id === i.id).length})
                </Button>
                {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(i)}>Edit</Button>}
              </div>
            </div>
            {unitsFor === i.id && (
              <ConversionsPanel
                ingredient={i}
                businessId={session.businessId}
                conversions={convs.filter((c) => c.ingredient_id === i.id)}
                canEdit={canEdit}
                canDelete={session.role === "owner" || session.role === "supa_admin"}
                onChanged={load}
                onError={(t) => setMsg({ ok: false, text: t })}
              />
            )}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function IngredientForm({
  businessId, initial, onCancel, onSaved, onError,
}: {
  businessId: string; initial: Ingredient | null;
  onCancel: () => void; onSaved: (t: string) => void; onError: (t: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [baseUnit, setBaseUnit] = useState(initial?.base_unit ?? "kg");
  const [cost, setCost] = useState(initial ? koboToNaira(initial.current_cost_kobo) : "");
  const [minQty, setMinQty] = useState(initial ? String(initial.min_threshold_qty) : "0");
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return onError("Name is required.");
    const newCost = nairaToKobo(cost);
    if (!(newCost >= 0)) return onError("Enter a valid price.");
    setBusy(true);
    const fields = {
      name: name.trim(), category: category.trim() || null, base_unit: baseUnit,
      min_threshold_qty: Number(minQty) || 0, supplier: supplier.trim() || null,
    };
    if (!initial) {
      const { error } = await supabase.from("ingredients").insert({
        ...fields, business_id: businessId, current_cost_kobo: newCost, previous_cost_kobo: 0, stock_base_qty: 0,
      });
      setBusy(false);
      return error ? onError("Could not add ingredient.") : onSaved(`${fields.name} added.`);
    }
    // Price change: read the price currently saved (not what the form loaded with),
    // and move it into previous_cost_kobo before writing the new one.
    const { data: live, error: readErr } = await supabase
      .from("ingredients").select("current_cost_kobo").eq("id", initial.id).single();
    if (readErr || !live) { setBusy(false); return onError("Could not read the current price."); }
    const priceChanged = Number(live.current_cost_kobo) !== newCost;
    const { error } = await supabase
      .from("ingredients")
      .update(priceChanged ? { ...fields, previous_cost_kobo: live.current_cost_kobo, current_cost_kobo: newCost, price_updated_at: new Date().toISOString() } : fields)
      .eq("id", initial.id);
    setBusy(false);
    if (error) return onError("Could not save ingredient.");
    onSaved(priceChanged
      ? `${fields.name} saved. Price ${formatNaira(Number(live.current_cost_kobo))} → ${formatNaira(newCost)}.`
      : `${fields.name} saved.`);
  }

  return (
    <form onSubmit={save} className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-medium text-card-foreground">{initial ? `Edit ${initial.name}` : "New ingredient"}</h2>
      <Field label="Name" id="ing-name"><Input id="ing-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" id="ing-cat"><Input id="ing-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Grains, Protein…" /></Field>
        <Field label="Base unit" id="ing-unit">
          <Select value={baseUnit} onValueChange={setBaseUnit}>
            <SelectTrigger id="ing-unit" aria-label="Base unit"><SelectValue /></SelectTrigger>
            <SelectContent>{BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Price per ${baseUnit} (₦)`} id="ing-cost">
          <Input id="ing-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label={`Reorder below (${baseUnit})`} id="ing-min">
          <Input id="ing-min" inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
      </div>
      <Field label="Supplier" id="ing-sup"><Input id="ing-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ConversionsPanel({
  ingredient, businessId, conversions, canEdit, canDelete, onChanged, onError,
}: {
  ingredient: Ingredient; businessId: string; conversions: Conversion[];
  canEdit: boolean; canDelete: boolean; onChanged: () => void; onError: (t: string) => void;
}) {
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const base_qty = Number(qty);
    if (!unit || !(base_qty > 0)) return onError("Pick a market unit and enter how much it holds.");
    setBusy(true);
    const existing = conversions.find((c) => c.market_unit === unit);
    const { error } = existing
      ? await supabase.from("unit_conversions").update({ base_qty }).eq("id", existing.id)
      : await supabase.from("unit_conversions").insert({ business_id: businessId, ingredient_id: ingredient.id, market_unit: unit, base_qty });
    setBusy(false);
    if (error) return onError("Could not save conversion.");
    setUnit(""); setQty(""); onChanged();
  }

  return (
    <div className="mt-3 rounded-md bg-muted p-3">
      <div className="text-sm font-medium text-foreground">Unit conversions for {ingredient.name}</div>
      <p className="text-xs text-muted-foreground">These only apply to {ingredient.name}. Other ingredients have their own.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {conversions.length === 0 && <li className="text-muted-foreground">None yet.</li>}
        {conversions.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="text-foreground">1 {c.market_unit.replace("_", " ")} = {Number(c.base_qty)} {ingredient.base_unit}</span>
            {canDelete && (
              <button
                className="text-xs text-muted-foreground underline"
                onClick={async () => {
                  const { error } = await supabase.from("unit_conversions").delete().eq("id", c.id);
                  if (error) onError("Could not remove conversion."); else onChanged();
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Market unit</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="w-40" aria-label="Market unit"><SelectValue placeholder="Pick" /></SelectTrigger>
              <SelectContent>{MARKET_UNITS.map((u) => <SelectItem key={u} value={u}>{u.replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs" htmlFor={`q-${ingredient.id}`}>Holds ({ingredient.base_unit})</Label>
            <Input id={`q-${ingredient.id}`} className="w-28" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <Button type="submit" size="sm" disabled={busy}>Save unit</Button>
        </form>
      )}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}
