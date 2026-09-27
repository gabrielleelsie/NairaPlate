import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, BadgeCheck, BarChart3, BookOpen, CalendarDays,
  ChefHat, ClipboardList, CreditCard, Delete, Flame, HandCoins, History,
  Landmark, Lock, Minus, PackageSearch, Plus, Printer, ReceiptText, Scale,
  ShoppingBasket, Store, Trash2, TrendingDown, TrendingUp, Truck, Users,
  UtensilsCrossed, WalletCards,
} from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  BUSINESS_CODE, INGREDIENTS, MARKET_UNITS, PARTY_JOLLOF_LINES, PICKABLE_INGREDIENTS,
  PNL, SALES_TREND, SAVED_RECIPES, STAFF, naira,
  type MarketUnit, type RecipeLine, type StaffProfile,
} from "./data";

/* ---------------------------------------------------------------- shared */

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-pres-surface text-pres-slate shadow-[0_24px_60px_rgba(2,12,30,0.35)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ScreenShell({
  title, subtitle, children, wide,
}: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("mx-auto w-full", wide ? "max-w-6xl" : "max-w-5xl")}>
      <div className="mb-4 sm:mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-300 sm:text-base">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------- 1. login gate screen */

export function LoginGateScreen() {
  const [code, setCode] = useState(BUSINESS_CODE);
  const [codeLocked, setCodeLocked] = useState(true);
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const wrong = pin.length === 4 && staff !== null && pin !== staff.pin;

  function press(digit: string) {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4 && staff && next === staff.pin) {
      setTimeout(() => setUnlocked(true), 350);
    }
  }

  return (
    <ScreenShell title="Sign in to your kitchen" subtitle="No emails, no passwords — a business code and a 4-digit PIN.">
      <Card className="mx-auto w-full max-w-xl p-5 sm:p-8">
        {unlocked ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-pres-blue/10 text-pres-blue">
              <BadgeCheck className="size-9" />
            </span>
            <p className="text-xl font-bold text-pres-slate">Welcome back, {staff?.name}</p>
            <p className="text-sm text-slate-500">Signed in as {staff?.role} · shift started</p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => { setUnlocked(false); setPin(""); setStaff(null); }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Business code
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                value={code}
                readOnly={codeLocked}
                autoCapitalize="none"
                onChange={(e) => setCode(e.target.value.trim().toLowerCase())}
                className="h-11 text-base font-semibold text-pres-slate"
              />
              <Button
                variant="outline"
                className="h-11 shrink-0"
                onClick={() => setCodeLocked((v) => !v)}
              >
                {codeLocked ? "Change" : "Save"}
              </Button>
            </div>

            <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Who is on shift?
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {STAFF.map((s) => {
                const active = staff?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setStaff(s); setPin(""); }}
                    className={cn(
                      "rounded-xl border-2 p-3 text-left transition-all",
                      active
                        ? "border-pres-blue bg-pres-blue/5 shadow-sm"
                        : "border-slate-200 hover:border-pres-blue/50 hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 items-center justify-center rounded-full text-sm font-bold",
                        active ? "bg-pres-blue text-white" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {s.initials}
                    </span>
                    <p className="mt-2 text-sm font-bold text-pres-slate">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.role}</p>
                  </button>
                );
              })}
            </div>

            {staff ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-semibold text-pres-slate">
                    <Lock className="size-4 text-pres-blue" /> {staff.name}'s PIN
                  </p>
                  <button
                    type="button"
                    className="text-xs font-semibold text-pres-blue underline-offset-2 hover:underline"
                    onClick={() => setPin(staff.pin)}
                  >
                    Use demo PIN
                  </button>
                </div>

                <div className="mt-3 flex justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "size-4 rounded-full border-2 transition-colors",
                        wrong
                          ? "border-pres-alert bg-pres-alert"
                          : i < pin.length
                            ? "border-pres-blue bg-pres-blue"
                            : "border-slate-300 bg-transparent",
                      )}
                    />
                  ))}
                </div>
                {wrong ? (
                  <p className="mt-2 text-center text-xs font-semibold text-pres-alert">
                    Wrong PIN — try again.
                  </p>
                ) : null}

                <div className="mx-auto mt-4 grid max-w-[15rem] grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => press(d)}
                      className="rounded-lg border border-slate-200 bg-white py-3 text-lg font-bold text-pres-slate transition-colors hover:border-pres-blue hover:bg-pres-blue/5 active:bg-pres-blue active:text-white"
                    >
                      {d}
                    </button>
                  ))}
                  <span />
                  <button
                    type="button"
                    onClick={() => press("0")}
                    className="rounded-lg border border-slate-200 bg-white py-3 text-lg font-bold text-pres-slate transition-colors hover:border-pres-blue hover:bg-pres-blue/5 active:bg-pres-blue active:text-white"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => setPin((p) => p.slice(0, -1))}
                    className="flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-pres-alert hover:text-pres-alert"
                    aria-label="Delete last digit"
                  >
                    <Delete className="size-5" />
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-6 text-center text-sm text-slate-400">
                Pick a name above to open the PIN pad.
              </p>
            )}
          </>
        )}
      </Card>
    </ScreenShell>
  );
}

/* ----------------------------------------------------- 2. dashboard grid */

const TILE_GROUPS: {
  label: string;
  tiles: { label: string; icon: typeof Store; badge?: string }[];
}[] = [
  {
    label: "Sell",
    tiles: [
      { label: "Till", icon: Store },
      { label: "Cash drawer", icon: WalletCards },
      { label: "Orders", icon: ReceiptText, badge: "12" },
      { label: "Customer credit", icon: CreditCard },
      { label: "Catering", icon: UtensilsCrossed },
    ],
  },
  {
    label: "Buy & stock",
    tiles: [
      { label: "Purchases", icon: ShoppingBasket },
      { label: "Suppliers", icon: Truck },
      { label: "Shopping list", icon: ClipboardList, badge: "3" },
      { label: "Ingredients", icon: PackageSearch },
    ],
  },
  {
    label: "Kitchen",
    tiles: [
      { label: "Recipes", icon: BookOpen },
      { label: "Log a batch", icon: ChefHat },
      { label: "Wastage", icon: Trash2 },
    ],
  },
  {
    label: "Oversight",
    tiles: [
      { label: "P&L", icon: BarChart3 },
      { label: "7-day cashflow", icon: CalendarDays },
      { label: "Alerts", icon: AlertTriangle, badge: "1" },
      { label: "Audit log", icon: History },
      { label: "Channel payouts", icon: Landmark },
      { label: "Pricing review", icon: HandCoins, badge: "1" },
      { label: "Staff", icon: Users },
      { label: "Print report", icon: Printer },
    ],
  },
];

export function DashboardScreen() {
  return (
    <ScreenShell wide title="Everything the owner runs" subtitle="Four working areas, one screen — no menus to hunt through.">
      <div className="grid gap-4 md:grid-cols-2">
        {TILE_GROUPS.map((group) => (
          <Card key={group.label} className="p-4 sm:p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-pres-blue">
              {group.label}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {group.tiles.map(({ label, icon: Icon, badge }) => (
                <div
                  key={label}
                  className="group relative flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 transition-all hover:-translate-y-0.5 hover:border-pres-blue hover:bg-white hover:shadow-md"
                >
                  {badge ? (
                    <span className="absolute right-2 top-2 rounded-full bg-pres-alert px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {badge}
                    </span>
                  ) : null}
                  <Icon className="size-5 text-pres-blue" />
                  <span className="text-xs font-semibold leading-tight text-pres-slate">{label}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </ScreenShell>
  );
}

/* --------------------------------------------------- 3. ingredients list */

export function IngredientsScreen() {
  return (
    <ScreenShell wide title="Ingredients & market prices" subtitle="Every stock line carries the price you paid last time and the price today.">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Ingredient</th>
                <th className="px-4 py-3 font-semibold">In stock</th>
                <th className="px-4 py-3 font-semibold">Reorder at</th>
                <th className="px-4 py-3 font-semibold">Last price</th>
                <th className="px-4 py-3 font-semibold">Today</th>
                <th className="px-4 py-3 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {INGREDIENTS.map((row) => {
                const delta = ((row.current - row.previous) / row.previous) * 100;
                const up = delta > 0;
                return (
                  <tr key={row.name} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-pres-slate">{row.name}</td>
                    <td className="px-4 py-3 text-slate-600">{row.stock}</td>
                    <td className="px-4 py-3 text-slate-400">{row.reorder}</td>
                    <td className="px-4 py-3 text-slate-400 line-through">{naira(row.previous)}</td>
                    <td className="px-4 py-3 font-bold text-pres-slate">
                      {naira(row.current)}
                      <span className="ml-1 text-xs font-normal text-slate-400">/ {row.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
                          up ? "bg-pres-alert/10 text-pres-alert" : "bg-emerald-50 text-emerald-600",
                        )}
                      >
                        {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {up ? "+" : ""}{delta.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </ScreenShell>
  );
}

/* --------------------------------------------- 4. interactive calculator */

export function CalculatorScreen() {
  const [lines, setLines] = useState<RecipeLine[]>(PARTY_JOLLOF_LINES);
  const [plates, setPlates] = useState(6);
  const [margin, setMargin] = useState(35);
  const [pick, setPick] = useState("");

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0),
    [lines],
  );
  const costPerPlate = plates > 0 ? total / plates : 0;
  const sellingPrice = costPerPlate / (1 - margin / 100);

  function update(id: string, patch: Partial<RecipeLine>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addPicked(name: string) {
    const src = PICKABLE_INGREDIENTS.find((i) => i.name === name);
    if (!src) return;
    setLines((ls) => [
      ...ls,
      { id: `${name}-${ls.length}`, name: src.name, qty: 1, unit: src.unit, unitCost: src.unitCost },
    ]);
    setPick("");
  }

  return (
    <ScreenShell wide title="Cost a plate in real market units" subtitle="Change a quantity or slide your margin — the selling price moves instantly.">
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Card className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recipe name</label>
              <Input defaultValue="Party Jollof" className="mt-1 h-10 font-semibold text-pres-slate" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Category</label>
              <Select defaultValue="rice">
                <SelectTrigger className="mt-1 h-10 text-pres-slate"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rice">Rice dishes</SelectItem>
                  <SelectItem value="swallow">Swallow</SelectItem>
                  <SelectItem value="soup">Soups &amp; stews</SelectItem>
                  <SelectItem value="protein">Protein &amp; sides</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Plates</label>
              <div className="mt-1 flex items-center gap-1">
                <Button variant="outline" size="icon" className="size-10 shrink-0"
                  onClick={() => setPlates((p) => Math.max(1, p - 1))} aria-label="Fewer plates">
                  <Minus className="size-4" />
                </Button>
                <Input
                  value={plates}
                  onChange={(e) => setPlates(Math.max(1, Number(e.target.value) || 1))}
                  className="h-10 text-center font-bold text-pres-slate"
                />
                <Button variant="outline" size="icon" className="size-10 shrink-0"
                  onClick={() => setPlates((p) => p + 1)} aria-label="More plates">
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {lines.map((line) => (
              <div
                key={line.id}
                className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 sm:grid-cols-[1.3fr_4.5rem_8rem_auto_auto]"
              >
                <p className="truncate text-sm font-semibold text-pres-slate">{line.name}</p>
                <Input
                  type="number"
                  step="0.25"
                  value={line.qty}
                  onChange={(e) => update(line.id, { qty: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-9 bg-white text-center text-sm"
                />
                <Select value={line.unit} onValueChange={(v) => update(line.id, { unit: v as MarketUnit })}>
                  <SelectTrigger className="h-9 bg-white text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MARKET_UNITS.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="w-24 text-right text-sm font-bold text-pres-slate">
                  {naira(line.qty * line.unitCost)}
                </p>
                <button
                  type="button"
                  aria-label={`Remove ${line.name}`}
                  onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))}
                  className="text-slate-300 transition-colors hover:text-pres-alert"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Select value={pick} onValueChange={addPicked}>
              <SelectTrigger className="h-10 text-sm text-slate-500">
                <SelectValue placeholder="+ Add an ingredient" />
              </SelectTrigger>
              <SelectContent>
                {PICKABLE_INGREDIENTS.map((i) => (
                  <SelectItem key={i.name} value={i.name}>
                    {i.name} — {naira(i.unitCost)} / {i.unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="flex flex-col p-4 sm:p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-pres-blue">Live costing</p>

          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Total batch cost</dt>
              <dd className="font-bold text-pres-slate">{naira(total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Plates in batch</dt>
              <dd className="font-bold text-pres-slate">{plates}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2">
              <dt className="text-slate-500">Cost per plate</dt>
              <dd className="font-bold text-pres-slate">{naira(costPerPlate)}</dd>
            </div>
          </dl>

          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Target margin
              </label>
              <span className="text-lg font-bold text-pres-blue">{margin}%</span>
            </div>
            <Slider
              className="mt-3"
              value={[margin]}
              min={35}
              max={57}
              step={1}
              onValueChange={([v]) => setMargin(v ?? 35)}
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-400">
              <span>35%</span><span>57%</span>
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-pres-navy p-4 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              Selling price per plate (auto)
            </p>
            <p className="mt-1 text-4xl font-black tracking-tight">{naira(sellingPrice)}</p>
            <p className="mt-1 text-xs text-slate-300">
              Keeps {naira(sellingPrice - costPerPlate)} profit on every plate you sell.
            </p>
          </div>

          <Button className="mt-4 h-11 w-full bg-pres-blue text-white hover:bg-pres-blue-deep">
            Save recipe &amp; price <ArrowRight className="ml-1 size-4" />
          </Button>
        </Card>
      </div>
    </ScreenShell>
  );
}

/* ------------------------------------------------- 5. pricing review */

export function PricingReviewScreen() {
  const [decision, setDecision] = useState<string | null>(null);

  return (
    <ScreenShell wide title="Pricing review" subtitle="NairaPlate watches your costs and tells you which dish is losing money.">
      <div className="space-y-4">
        <Card className="border-l-4 border-l-pres-alert p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pres-alert/10 text-pres-alert">
              <Flame className="size-5" />
            </span>
            <div className="min-w-[14rem] flex-1">
              <p className="text-base font-bold text-pres-slate">Jollof Rice has fallen behind target margin</p>
              <p className="mt-1 text-sm text-slate-500">
                Rice is up 21.4% and pepper mix up 41.5% since this price was set.
              </p>
              <div className="mt-3 flex flex-wrap gap-5">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Current price</p>
                  <p className="text-xl font-bold text-slate-400 line-through">{naira(3500)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Suggested price</p>
                  <p className="text-xl font-black text-pres-blue">{naira(4440)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Gap</p>
                  <p className="text-xl font-bold text-pres-alert">+26.9%</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              className="bg-pres-blue text-white hover:bg-pres-blue-deep"
              onClick={() => setDecision("Published — Jollof Rice now sells at ₦4,440.")}
            >
              Publish
            </Button>
            <Button variant="outline" onClick={() => setDecision("Portion adjusted — batch re-costed at 7 plates.")}>
              Adjust portion
            </Button>
            <Button variant="ghost" className="text-slate-500" onClick={() => setDecision("Deferred — we'll ask again in 7 days.")}>
              Defer
            </Button>
          </div>

          {decision ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              <BadgeCheck className="size-4" /> {decision} Logged to the audit trail.
            </p>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-pres-blue">
            Saved recipes
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Dish</th>
                  <th className="px-4 py-2.5 font-semibold">Cost per plate</th>
                  <th className="px-4 py-2.5 font-semibold">Selling now</th>
                  <th className="px-4 py-2.5 font-semibold">Suggested</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {SAVED_RECIPES.map((r) => {
                  const behind = r.suggestedPrice > r.currentPrice;
                  return (
                    <tr key={r.name} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-semibold text-pres-slate">{r.name}</td>
                      <td className="px-4 py-3 text-slate-600">{naira(r.costPerPlate)}</td>
                      <td className="px-4 py-3 text-slate-600">{naira(r.currentPrice)}</td>
                      <td className="px-4 py-3 font-bold text-pres-slate">{naira(r.suggestedPrice)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-bold",
                          behind ? "bg-pres-alert/10 text-pres-alert" : "bg-emerald-50 text-emerald-600",
                        )}>
                          {behind ? "Behind target" : "On target"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </ScreenShell>
  );
}

/* ------------------------------------------------------------- 6. P&L */

export function PnlScreen() {
  return (
    <ScreenShell wide title="Profit & loss, last 7 days" subtitle="Real money in, real food used, and what is actually left.">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Money from sales", value: PNL.sales, tone: "text-pres-slate", badge: null },
          { label: "Cost of food used", value: PNL.foodCost, tone: "text-pres-alert", badge: `${PNL.foodCostPct}% of sales` },
          { label: "Profit after food cost", value: PNL.profit, tone: "text-pres-blue", badge: `${PNL.profitPct}% margin` },
        ].map((m) => (
          <Card key={m.label} className="p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{m.label}</p>
            <p className={cn("mt-1 text-3xl font-black tracking-tight", m.tone)}>{naira(m.value)}</p>
            {m.badge ? (
              <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                {m.badge}
              </span>
            ) : null}
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-pres-blue">Daily sales vs food cost</p>
        <div className="mt-4 h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={SALES_TREND} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip
                formatter={(v: number) => naira(v)}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
              />
              <Line type="monotone" dataKey="sales" name="Sales" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="food" name="Food cost" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </ScreenShell>
  );
}

/* --------------------------------------------------------- 7. end card */

export function EndCardScreen({ onReplay }: { onReplay: () => void }) {
  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute -z-10 size-[28rem] rounded-full bg-pres-blue/20 blur-[120px]" />
      <Logo size={64} variant="white" layout="stacked" />
      <h2 className="mt-8 text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
        Never guess plate costs again.
      </h2>
      <p className="mt-4 text-lg text-slate-300 sm:text-xl">Protect your food margins.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={onReplay} className="h-11 bg-pres-blue px-6 text-white hover:bg-pres-blue-deep">
          Replay walkthrough
        </Button>
        <a
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-md border border-white/25 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
        >
          Open the live system
        </a>
      </div>
      <p className="mt-8 flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-slate-400">
        <Scale className="size-4" /> Built for Nigerian kitchens
      </p>
    </div>
  );
}
