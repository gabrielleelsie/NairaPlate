import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { isOwnerRole } from "@/lib/catering-order";
import { lagosDateKey, lagosDayStart, DAY_MS, LAGOS_OFFSET_MS } from "@/lib/lagos-time";
import { REPORT_SCHEMAS, MANIFEST_COLUMNS, toCsv, exportFilename, checksum, sumKoboColumn, downloadCsv, lagosDateTime, type CsvRow, type ReportId } from "@/lib/csv-export";
import { fetchReport, AMOUNT_COLUMN, type Range } from "@/lib/accountant-reports";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/exports")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Accountant exports — NairaPlate" },
      { name: "description", content: "Download sales, cash, supplier, customer, refund, wastage and batch ledgers as clean CSV files for your accountant." },
      { property: "og:title", content: "Accountant exports — NairaPlate" },
      { property: "og:description", content: "Clean CSV ledgers for Excel, Google Sheets, QuickBooks or Zoho Books." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExportsScreen,
});

const REPORTS: { id: ReportId; title: string; about: string }[] = [
  { id: "sales_day_book", title: "Sales Day Book", about: "Every sale with refunds taken off, paper sales marked, and how sure the food cost is." },
  { id: "cash_drawer_summary", title: "Cash Drawer Summary", about: "Each shift: float, expected cash, counted cash, shortage or overage and owner corrections." },
  { id: "cash_paid_out_register", title: "Cash Paid-Out Register", about: "Every naira taken out of the till, who took it, who approved it and any reversal." },
  { id: "supplier_ledger", title: "Supplier Ledger", about: "What you owe each supplier: opening, credit buys, payments, closing and how old it is." },
  { id: "customer_ledger", title: "Customer Ledger", about: "Customer debts: original amount, repayments, write-offs, balance and how old it is." },
  { id: "refund_reversal_register", title: "Refund & Reversal Register", about: "Every void, refund and reversal across sales, suppliers, cash, credit and batches." },
  { id: "wastage_log", title: "Wastage Log", about: "Spoiled or lost ingredients with quantity, unit, cost and reason." },
  { id: "batch_production", title: "Batch Production", about: "Kitchen batches with locked-in cost, portions made and cost per plate." },
];

type Preset = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" }, { id: "this_month", label: "This month" }, { id: "last_month", label: "Last month" }, { id: "custom", label: "Custom" },
];

const startOfKey = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - LAGOS_OFFSET_MS);
function presetKeys(p: Preset, now = new Date()): [string, string] {
  const today = lagosDayStart(now); const k = (d: Date) => lagosDateKey(d); const add = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
  const dow = (new Date(today.getTime() + LAGOS_OFFSET_MS).getUTCDay() + 6) % 7; // Monday = 0
  const [y, m] = k(today).split("-").map(Number) as [number, number];
  const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  switch (p) {
    case "yesterday": return [k(add(today, -1)), k(add(today, -1))];
    case "this_week": return [k(add(today, -dow)), k(today)];
    case "last_week": return [k(add(today, -dow - 7)), k(add(today, -dow - 1))];
    case "this_month": return [monthStart(y, m), k(today)];
    case "last_month": { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [monthStart(py, pm), k(add(startOfKey(monthStart(y, m)), -1))]; }
    default: return [k(today), k(today)];
  }
}
const toRange = (fromKey: string, toKey: string): Range => ({ fromKey, toKey, fromIso: startOfKey(fromKey).toISOString(), toIso: new Date(startOfKey(toKey).getTime() + DAY_MS).toISOString() });

type Result = { rows: CsvRow[] } | { error: string };

function ExportsScreen() {
  const { loading, session } = useStaffSession();
  const [preset, setPreset] = useState<Preset>("this_month");
  const [[fromKey, toKey], setKeys] = useState<[string, string]>(() => presetKeys("this_month"));
  const [results, setResults] = useState<Partial<Record<ReportId, Result>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const valid = !!fromKey && !!toKey && fromKey <= toKey;

  const load = useCallback(async () => {
    if (!session || !valid) return;
    setBusy(true); setResults({}); setNote("");
    const ctx = { supabase, businessId: session.businessId, range: toRange(fromKey, toKey) };
    const out: Partial<Record<ReportId, Result>> = {};
    await Promise.all(REPORTS.map(async (r) => {
      try { out[r.id] = { rows: await fetchReport(r.id, ctx) }; }
      catch (e) { console.error(`Export ${r.id} failed`, e); out[r.id] = { error: "Could not load data for this report. Please try a narrower date range or contact support." }; }
    }));
    setResults(out); setBusy(false);
  }, [session, fromKey, toKey, valid]);

  useEffect(() => { if (session && isOwnerRole(session.role)) void load(); }, [load, session]);

  function fileFor(id: ReportId) {
    const res = results[id];
    if (!res || "error" in res) return null;
    const text = toCsv(REPORT_SCHEMAS[id].columns, res.rows);
    return { name: exportFilename(id, fromKey, toKey), text, rows: res.rows };
  }
  const manifestRow = (id: ReportId, f: NonNullable<ReturnType<typeof fileFor>>, at: string): CsvRow => ({
    report_name: id, report_version: REPORT_SCHEMAS[id].version, file_name: f.name, generated_at_lagos: at,
    generated_by_user_id: session?.userId, generated_by_display_name: session?.name, date_from_lagos: fromKey, date_to_lagos: toKey,
    row_count: f.rows.length, amount_total_kobo: sumKoboColumn(f.rows, AMOUNT_COLUMN[id]), checksum: checksum(f.text),
  });

  async function downloadOne(id: ReportId) { const f = fileFor(id); if (f) await downloadCsv(f.name, f.text); }
  async function downloadAll() {
    const at = lagosDateTime(new Date().toISOString()); const manifest: CsvRow[] = [];
    for (const r of REPORTS) {
      const f = fileFor(r.id); if (!f) continue;
      await downloadCsv(f.name, f.text); manifest.push(manifestRow(r.id, f, at));
      await new Promise((res) => setTimeout(res, 400));
    }
    await downloadCsv(exportFilename("manifest", fromKey, toKey), toCsv(MANIFEST_COLUMNS, manifest));
    setNote(`${manifest.length} reports and the cover sheet were downloaded. Your browser may ask to allow several downloads.`);
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !isOwnerRole(session.role)) return <main className="p-6 space-y-3"><p>Owners only.</p><Link className="underline" to="/app">Back</Link></main>;

  const input = "h-10 rounded-md border border-input bg-background px-3";
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Accountant exports</h1>
          <Link className="text-sm underline" to="/app">Home</Link>
        </div>
        <p className="text-sm text-muted-foreground">CSV files for Excel, Google Sheets, QuickBooks or Zoho Books. Amounts are plain naira numbers; days run in Nigeria time. Nothing here changes your records.</p>

        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant={preset === p.id ? "default" : "outline"}
                onClick={() => { setPreset(p.id); if (p.id !== "custom") setKeys(presetKeys(p.id)); }}>{p.label}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">From<br /><input type="date" className={input} value={fromKey} onChange={(e) => { setPreset("custom"); setKeys([e.target.value, toKey]); }} /></label>
            <label className="text-sm">To<br /><input type="date" className={input} value={toKey} onChange={(e) => { setPreset("custom"); setKeys([fromKey, e.target.value]); }} /></label>
            <Button disabled={busy || !valid || Object.keys(results).length === 0} onClick={() => void downloadAll()}>Download all + cover sheet</Button>
          </div>
          {!valid && <p className="text-sm text-destructive">Pick a start date on or before the end date.</p>}
          {note && <p className="text-sm">{note}</p>}
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map((r) => {
            const res = results[r.id];
            return (
              <article key={r.id} className="flex flex-col gap-2 rounded-lg border p-4">
                <h2 className="font-semibold">{r.title}</h2>
                <p className="flex-1 text-sm text-muted-foreground">{r.about}</p>
                <p className="text-sm">
                  {busy || !res ? "Loading…" : "error" in res ? <span className="text-destructive">{res.error}</span>
                    : res.rows.length === 0 ? "No records found for these dates." : `${res.rows.length} rows · ${fromKey} to ${toKey}`}
                </p>
                <Button size="sm" variant="outline" disabled={busy || !res || "error" in res} onClick={() => void downloadOne(r.id)}>Download CSV</Button>
              </article>
            );
          })}
        </div>

        <section className="space-y-2 rounded-lg border p-4 text-sm">
          <h2 className="font-semibold">Help for accountants</h2>
          <p><b>Opening in Excel:</b> double-click the file, or use Data → From Text/CSV and choose UTF-8. Naira columns are numbers, so SUM and pivot tables work straight away. Each naira column has a matching kobo column for exact checks.</p>
          <p><b>Cover sheet (manifest):</b> lists every file, its version, who made it and when, the dates, row count, a kobo total and a checksum. A changed file will no longer match its checksum.</p>
          <p><b>Void:</b> a sale cancelled in full; it earns nothing. <b>Refund:</b> money given back on a paid sale, full or part. <b>Reversal:</b> an owner's entry that cancels an earlier payment, payout or batch; the original stays on record.</p>
          <p><b>Late entry:</b> a paper sale written during an outage and posted later after owner approval, priced at the actual sale time.</p>
          <p><b>Cost confidence:</b> snapshot = cost locked in at the till; high = exact price at sale time; medium = price from backfilled history; low = estimated at today's price or unknown.</p>
          <p><b>Ageing:</b> balances are split by how old the unpaid charges are, assuming older charges are paid first.</p>
        </section>
      </div>
    </main>
  );
}
