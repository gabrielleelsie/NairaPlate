import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";

export const Route = createFileRoute("/shopping-list")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Shopping list — NairaPlate" },
      { name: "description", content: "What to buy: ingredients at or below their reorder level, with a suggested amount and cost." },
      { property: "og:title", content: "Shopping list — NairaPlate" },
      { property: "og:description", content: "What to buy: ingredients at or below their reorder level, with a suggested amount and cost." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShoppingListScreen,
});

type Ing = {
  id: string; name: string; base_unit: string;
  current_cost_kobo: number; stock_base_qty: number; min_threshold_qty: number;
};
type Conv = { ingredient_id: string; market_unit: string; base_qty: number };
type Row = { name: string; negative: boolean; stockText: string; buyText: string; estCostKobo: number };

const ROLES = new Set(["purchaser", "owner", "supa_admin"]);

function ShoppingListScreen() {
  const { loading, session } = useStaffSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [ing, conv] = await Promise.all([
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo,stock_base_qty,min_threshold_qty").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
    ]);
    if (ing.error || conv.error) return setError("Could not load ingredients.");
    const ings: Ing[] = (ing.data ?? []).map((i) => ({
      ...i,
      current_cost_kobo: Number(i.current_cost_kobo),
      stock_base_qty: Number(i.stock_base_qty),
      min_threshold_qty: Number(i.min_threshold_qty),
    }));
    const convs: Conv[] = (conv.data ?? []).map((c) => ({ ...c, base_qty: Number(c.base_qty) }));
    const out: Row[] = [];
    for (const i of ings) {
      if (i.stock_base_qty > i.min_threshold_qty) continue; // above reorder level — nothing needed
      const need = i.min_threshold_qty - i.stock_base_qty;
      if (need <= 0) continue; // at the level with nothing to top up
      // Prefer a market unit that fits the need: largest conversion that fits, else the largest.
      const convsFor = convs.filter((c) => c.ingredient_id === i.id).sort((a, b) => b.base_qty - a.base_qty);
      const pick = convsFor.find((c) => c.base_qty <= need) ?? convsFor[0];
      out.push({
        name: i.name,
        negative: i.stock_base_qty < 0,
        stockText: `${fmtQty(i.stock_base_qty)} ${i.base_unit}`,
        buyText: pick
          ? `${fmtQty(Math.ceil((need / pick.base_qty) * 10) / 10)} ${pick.market_unit} (${fmtQty(need)} ${i.base_unit})`
          : `${fmtQty(need)} ${i.base_unit}`,
        estCostKobo: Math.round(need * i.current_cost_kobo),
      });
    }
    setRows(out);
  }, []);

  useEffect(() => { if (session && ROLES.has(session.role)) load(); }, [session, load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/" className="underline text-sm">Go to sign-in</Link></Shell>;
  if (!ROLES.has(session.role)) return <Shell><p className="text-muted-foreground">Only the purchaser, owner or supa admin can see the shopping list.</p><Link to="/" className="underline text-sm">← Home</Link></Shell>;

  return (
    <Shell>
      <Link to="/" className="text-sm text-muted-foreground underline print:hidden">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Shopping list</h1>
      <p className="mt-1 text-sm text-muted-foreground">Everything at or below its reorder level, and about what it will cost.</p>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {rows === null && !error && <p className="mt-6 text-muted-foreground">Loading…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="mt-6 text-muted-foreground">Nothing to buy right now — every ingredient is above its reorder level.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((r) => (
            <li key={r.name} className="p-4" data-testid="shopping-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{r.name}</div>
                  <div className={`text-sm ${r.negative ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                    In stock: {r.stockText}{r.negative ? " (below zero, stock count is off)" : ""}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium text-foreground">Buy about {r.buyText}</div>
                  <div className="text-muted-foreground">≈ {formatNaira(r.estCostKobo)}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        The suggested amount tops the stock back up to its reorder level. Costs use today's prices — check the market before you buy.
      </p>
    </Shell>
  );
}

function fmtQty(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}
