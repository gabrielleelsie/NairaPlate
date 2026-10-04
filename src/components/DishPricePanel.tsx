import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/external-supabase";
import { formatNaira } from "@/lib/costing";
import { SOURCE_LABEL, formatLagos, lagosLocalToIso, priceStatus, type DishPriceRow } from "@/lib/dish-prices";

// Owner / Supa Admin only. Prices are add-only: a started price is never edited; a scheduled one can be cancelled before it starts.
export function DishPricePanel({ dishId, onChanged }: { dishId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<DishPriceRow[]>([]);
  const [price, setPrice] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("dish_price_periods" as never)
      .select("id,price_kobo,effective_from,effective_to,source,set_by_name").eq("dish_id", dishId).order("effective_from", { ascending: false });
    if (error) return setMsg({ ok: false, text: "Could not load price history." });
    setRows(((data ?? []) as DishPriceRow[]).map((r) => ({ ...r, price_kobo: Number(r.price_kobo) })));
  }, [dishId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const naira = Number(price);
    if (!Number.isFinite(naira) || naira <= 0) return setMsg({ ok: false, text: "Enter a price above zero." });
    let from: string | null = null;
    if (when === "later") {
      from = lagosLocalToIso(at);
      if (!from || Date.parse(from) <= Date.now()) return setMsg({ ok: false, text: "Pick a future date and time." });
    }
    setBusy(true);
    const { error } = await supabase.rpc("set_dish_price" as never, { p_dish: dishId, p_price_kobo: Math.round(naira * 100), p_from: from } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: from ? `New price scheduled for ${formatLagos(from)}.` : "New price is now in use." });
    setPrice(""); setAt(""); void load(); onChanged();
  }

  async function cancel(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("cancel_dish_price" as never, { p_id: id } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "Scheduled price cancelled." }); void load();
  }

  const now = Date.now();
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div>
        <h3 className="font-medium">Price history</h3>
        <p className="text-xs text-muted-foreground">A price that has started can't be changed. To change it, set a new price. Past sales keep the price they were sold at.</p>
      </div>
      <ul className="grid gap-1 text-sm">
        {rows.length === 0 && <li className="text-muted-foreground">No price history yet.</li>}
        {rows.map((r) => {
          const s = priceStatus(r, now);
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0">
              <span>
                <strong>{formatNaira(r.price_kobo)}</strong>{" "}
                <span className="text-muted-foreground">
                  {s === "scheduled" ? `Starts ${formatLagos(r.effective_from)}` : `${formatLagos(r.effective_from)} → ${r.effective_to ? formatLagos(r.effective_to) : "now"}`}
                  {" · "}{r.set_by_name ?? SOURCE_LABEL[r.source]}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs uppercase text-muted-foreground">{s === "scheduled" ? "Scheduled" : s === "current" ? "In use" : "Ended"}</span>
                {s === "scheduled" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => cancel(r.id)}>Cancel</Button>}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2">
        <Label htmlFor="np-price">Set new price (₦)</Label>
        <Input id="np-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <div className="flex gap-2" role="radiogroup" aria-label="When the price starts">
          <Button type="button" size="sm" role="radio" aria-checked={when === "now"} variant={when === "now" ? "default" : "outline"} onClick={() => setWhen("now")}>Start now</Button>
          <Button type="button" size="sm" role="radio" aria-checked={when === "later"} variant={when === "later" ? "default" : "outline"} onClick={() => setWhen("later")}>Start on…</Button>
        </div>
        {when === "later" && (
          <>
            <Label htmlFor="np-at">Start date and time (Lagos)</Label>
            <Input id="np-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </>
        )}
        <Button type="button" disabled={busy} onClick={save}>{when === "now" ? "Use this price now" : "Schedule price"}</Button>
        {msg && <p className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{msg.text}</p>}
      </div>
    </div>
  );
}
