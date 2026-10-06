import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OperatingMode } from "@/lib/features";
import {
  DEFAULT_REMINDERS, KIND_LABEL, REMINDER_KINDS, REMINDER_PLACEHOLDERS, REMINDER_SCHEMA, parseDays, type ReminderKind, type ReminderSettings,
} from "@/lib/reminders";
import {
  DEFAULT_SETTINGS, PLACEHOLDERS, SETTING_LABEL, SETTING_SCHEMAS, PLAN_MODES, PLAN_NAME, bannerWhen, formatPrice, nairaTextToKobo, renderTemplate, savingPercent, setupText,
  type ExpiryBannerText, type LockedScreenText, type PlatformSettings, type SettingKey,
} from "@/lib/platform-settings";

type Api = (body: unknown) => Promise<{ status: number; data: Record<string, unknown> }>;
type Meta = Record<string, { updated_at: string; updated_by_name: string | null }>;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
const kobo2text = (k: number | null) => (k === null ? "" : String(k / 100));

// Platform admin only: change prices and the wording customers see, without a code change.
// Every save asks for the admin's own PIN, and the old and new values go to the audit trail.
export function PlatformSettingsPanel({ callApi }: { callApi: Api }) {
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [reminders, setReminders] = useState<ReminderSettings>(DEFAULT_REMINDERS);
  const [newsOn, setNewsOn] = useState(true);
  const [custom, setCustom] = useState<string[]>([]);
  const [meta, setMeta] = useState<Meta>({});
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { status, data } = await callApi({ action: "get_settings" });
    if (status !== 200) return setErr(String(data["error"] ?? "Could not load settings."));
    setSettings(data["settings"] as PlatformSettings);
    setReminders(data["reminders"] as ReminderSettings);
    setNewsOn((data["news"] as { enabled: boolean } | undefined)?.enabled !== false);
    setCustom((data["custom"] ?? []) as string[]);
    setMeta((data["meta"] ?? {}) as Meta);
    setErr(null); setLoaded(true);
  }, [callApi]);
  useEffect(() => { load(); }, [load]);

  if (err) return <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{err}</p>;
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const props = { callApi, custom, meta, reload: load };
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Changes show to customers straight away. Each save asks for your PIN and is written to the audit trail with the old and new text.
        Nothing here changes any customer's access dates.
      </p>
      <PricesCard {...props} value={settings.prices} />
      <LockedCard {...props} value={settings.locked_screen} />
      <BannerCard {...props} value={settings.expiry_banner} />
      <RemindersCard {...props} value={reminders} />
      <NewsCard {...props} on={newsOn} />
    </div>
  );
}

type CardProps = { callApi: Api; custom: string[]; meta: Meta; reload: () => Promise<void> };

function useSaver(k: SettingKey | "reminders" | "news", { callApi, reload }: CardProps) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(body: Record<string, unknown>, okText: string) {
    setBusy(true); setMsg(null);
    const { status, data } = await callApi({ ...body, key: k, admin_pin: pin });
    setBusy(false); setPin("");
    if (status !== 200) return setMsg({ ok: false, text: String(data["error"] ?? "That did not save.") });
    setMsg({ ok: true, text: okText });
    await reload();
  }
  return { pin, setPin, busy, msg, setMsg, run };
}

function Card({ k, props, saver, children, onSave, onReset, error }: {
  k: SettingKey | "reminders" | "news"; props: CardProps; saver: ReturnType<typeof useSaver>; children: React.ReactNode;
  onSave: () => void; onReset: () => void; error: string | null;
}) {
  const isCustom = props.custom.includes(k);
  const m = props.meta[k];
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid={`setting-${k}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-card-foreground">{k === "reminders" ? "Reminder emails" : k === "news" ? "News watch" : SETTING_LABEL[k]}</h2>
        <span className="text-xs text-muted-foreground">
          {isCustom ? `Edited${m?.updated_by_name ? ` by ${m.updated_by_name}` : ""}${m ? ` on ${fmt(m.updated_at)}` : ""}` : "Using the built-in wording"}
        </span>
      </div>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <div className="grid gap-1">
          <Label htmlFor={`pin-${k}`} className="text-xs">Your own PIN</Label>
          <Input id={`pin-${k}`} type="password" inputMode="numeric" className="h-9 w-32" value={saver.pin} onChange={(e) => saver.setPin(e.target.value.replace(/\D/g, ""))} />
        </div>
        <Button size="sm" disabled={saver.busy || saver.pin.length < 4 || !!error} onClick={onSave} className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90">Save</Button>
        {isCustom && <Button size="sm" variant="outline" disabled={saver.busy || saver.pin.length < 4} onClick={onReset}>Reset to built-in</Button>}
      </div>
      {saver.msg && <p className={`text-sm ${saver.msg.ok ? "text-foreground" : "text-destructive"}`}>{saver.msg.text}</p>}
    </section>
  );
}

const FIELDS = [["monthly_kobo", "Monthly (₦)"], ["quarterly_kobo", "3 months (₦)"], ["yearly_kobo", "12 months (₦)"], ["setup_kobo", "Setup, paid once (₦)"]] as const;
type PriceText = Record<OperatingMode, { monthly_kobo: string; quarterly_kobo: string; yearly_kobo: string; setup_kobo: string; setup_from: boolean }>;
const toText = (v: PlatformSettings["prices"]): PriceText =>
  Object.fromEntries(PLAN_MODES.map((m) => {
    const p = v.plans[m];
    return [m, { monthly_kobo: kobo2text(p.monthly_kobo), quarterly_kobo: kobo2text(p.quarterly_kobo), yearly_kobo: kobo2text(p.yearly_kobo), setup_kobo: kobo2text(p.setup_kobo), setup_from: p.setup_from }];
  })) as PriceText;

function PricesCard(props: CardProps & { value: PlatformSettings["prices"] }) {
  const saver = useSaver("prices", props);
  const [t, setT] = useState<PriceText>(toText(props.value));
  useEffect(() => setT(toText(props.value)), [props.value]);
  const parsed = {
    plans: Object.fromEntries(PLAN_MODES.map((m) => [m, {
      monthly_kobo: nairaTextToKobo(t[m].monthly_kobo), quarterly_kobo: nairaTextToKobo(t[m].quarterly_kobo),
      yearly_kobo: nairaTextToKobo(t[m].yearly_kobo), setup_kobo: nairaTextToKobo(t[m].setup_kobo), setup_from: t[m].setup_from,
    }])),
  };
  const bad = Object.values(parsed.plans).some((p) => Object.values(p).includes(undefined));
  const result = bad ? null : SETTING_SCHEMAS.prices.safeParse(parsed);
  const error = bad ? "Enter prices as numbers, for example 15000 or 15,000.50. Leave a box blank to show no price." : result && !result.success ? (result.error.issues[0]?.message ?? "Check the prices.") : null;
  const plans = parsed.plans as PlatformSettings["prices"]["plans"];
  return (
    <Card k="prices" props={props} saver={saver} error={error}
      onSave={() => saver.run({ action: "save_setting", value: parsed }, "Prices saved. The pricing page, FAQ and locked screen show them.")}
      onReset={() => saver.run({ action: "reset_setting" }, "Prices reset to the standard price list.")}>
      <p className="text-sm text-muted-foreground">
        One row of boxes for each plan. They show on the pricing page, in the FAQ and on the locked screen, and fill in the amount when you record a payment.
        Leave a box blank and no price is shown for it. The "save" percentage on the website is worked out from these prices.
      </p>
      {PLAN_MODES.map((m) => (
        <div key={m} className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="font-semibold text-foreground">{PLAN_NAME[m]}</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            {FIELDS.map(([f, label]) => (
              <div key={f} className="grid gap-1">
                <Label htmlFor={`price-${m}-${f}`}>{label}</Label>
                <Input id={`price-${m}-${f}`} inputMode="decimal" value={t[m][f]} placeholder="not set"
                  onChange={(e) => setT((x) => ({ ...x, [m]: { ...x[m], [f]: e.target.value } }))} />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={t[m].setup_from} onChange={(e) => setT((x) => ({ ...x, [m]: { ...x[m], setup_from: e.target.checked } }))} />
            Show the setup fee as "from" (the final amount depends on the kitchen)
          </label>
          {!bad && (
            <p className="text-xs text-muted-foreground">
              Preview: Monthly {formatPrice(plans[m].monthly_kobo) ?? "(no price)"} · 3 months {formatPrice(plans[m].quarterly_kobo) ?? "(no price)"}
              {savingPercent(plans[m], "quarterly") ? ` (save ${savingPercent(plans[m], "quarterly")}%)` : ""} · 12 months {formatPrice(plans[m].yearly_kobo) ?? "(no price)"}
              {savingPercent(plans[m], "yearly") ? ` (save ${savingPercent(plans[m], "yearly")}%)` : ""} · Setup {setupText(plans[m]) ?? "(no price)"}
            </p>
          )}
        </div>
      ))}
    </Card>
  );
}

const SAMPLE = { business: "Mama Put Kitchen", date: "30 September 2026" };
const hint = (allowed: readonly string[]) => (allowed.length ? `Placeholders: ${allowed.map((n) => `{${n}}`).join(" ")}` : "No placeholders");

function LockedCard(props: CardProps & { value: LockedScreenText }) {
  const saver = useSaver("locked_screen", props);
  const [f, setF] = useState({ ...props.value, stepsText: props.value.steps.join("\n") });
  useEffect(() => setF({ ...props.value, stepsText: props.value.steps.join("\n") }), [props.value]);
  const value = useMemo(() => ({
    title: f.title, intro: f.intro, intro_no_date: f.intro_no_date, whatsapp_message: f.whatsapp_message,
    steps: f.stepsText.split("\n").map((s) => s.trim()).filter(Boolean),
  }), [f]);
  const r = SETTING_SCHEMAS.locked_screen.safeParse(value);
  const error = r.success ? null : (r.error.issues[0]?.message ?? "Check the wording.");
  const P = PLACEHOLDERS.locked_screen;
  const field = (id: keyof typeof P, label: string, long = false) => (
    <div className="grid gap-1">
      <Label htmlFor={`locked-${id}`}>{label}</Label>
      {long
        ? <textarea id={`locked-${id}`} rows={2} className="rounded-md border border-input bg-background p-2 text-sm" value={String(f[id as "intro"])} onChange={(e) => setF((x) => ({ ...x, [id]: e.target.value }))} />
        : <Input id={`locked-${id}`} value={String(f[id as "title"])} onChange={(e) => setF((x) => ({ ...x, [id]: e.target.value }))} />}
      <span className="text-xs text-muted-foreground">{hint(P[id])}</span>
    </div>
  );
  return (
    <Card k="locked_screen" props={props} saver={saver} error={error}
      onSave={() => saver.run({ action: "save_setting", value }, "Locked screen wording saved.")}
      onReset={() => saver.run({ action: "reset_setting" }, "Locked screen wording reset to the built-in text.")}>
      {field("title", "Title")}
      {field("intro", "Opening line when there is an end date", true)}
      {field("intro_no_date", "Opening line when there is no end date", true)}
      <div className="grid gap-1">
        <Label htmlFor="locked-steps">Steps (one per line, up to 6)</Label>
        <textarea id="locked-steps" rows={4} className="rounded-md border border-input bg-background p-2 text-sm" value={f.stepsText} onChange={(e) => setF((x) => ({ ...x, stepsText: e.target.value }))} />
      </div>
      {field("whatsapp_message", "WhatsApp message the button opens with")}
      <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
        <div className="text-xs uppercase text-muted-foreground">Preview</div>
        <div className="font-semibold text-foreground">{value.title}</div>
        <div className="text-foreground">{renderTemplate(value.intro, SAMPLE)}</div>
        <ol className="list-decimal pl-5 text-foreground">{value.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <div className="text-xs text-muted-foreground">WhatsApp opens with: "{renderTemplate(value.whatsapp_message, SAMPLE)}"</div>
      </div>
    </Card>
  );
}

function BannerCard(props: CardProps & { value: ExpiryBannerText }) {
  const saver = useSaver("expiry_banner", props);
  const [text, setText] = useState(props.value.text);
  useEffect(() => setText(props.value.text), [props.value]);
  const r = SETTING_SCHEMAS.expiry_banner.safeParse({ text });
  const error = r.success ? null : (r.error.issues[0]?.message ?? "Check the wording.");
  return (
    <Card k="expiry_banner" props={props} saver={saver} error={error}
      onSave={() => saver.run({ action: "save_setting", value: { text } }, "Expiry warning saved.")}
      onReset={() => saver.run({ action: "reset_setting" }, "Expiry warning reset to the built-in text.")}>
      <p className="text-sm text-muted-foreground">The amber banner owners see in the last 3 days of their plan.</p>
      <div className="grid gap-1">
        <Label htmlFor="banner-text">Banner text</Label>
        <textarea id="banner-text" rows={2} className="rounded-md border border-input bg-background p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
        <span className="text-xs text-muted-foreground">{hint(PLACEHOLDERS.expiry_banner.text)}. {"{when}"} becomes "today at 11:59 pm", "tomorrow at 11:59 pm" or "in 2 days". {"{days}"} is the number of calendar days left, counting today.</span>
      </div>
      <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
        <div className="text-xs uppercase text-muted-foreground">Preview</div>
        {[1, 2, 3].map((d) => <div key={d} className="rounded bg-amber-100 px-3 py-1 text-amber-900">{renderTemplate(text, { when: bannerWhen(d), days: String(d) })}</div>)}
      </div>
    </Card>
  );
}


type DueRow = { business_id: string; name: string; plan: string | null; kind: ReminderKind; offset: number; ends_at: string; owner_emails: number };
type LogRow = { business_id: string; business_name: string; kind: string; offset_days: number; recipients: number; sent: number; created_at: string };

function RemindersCard(props: CardProps & { value: ReminderSettings }) {
  const saver = useSaver("reminders", props);
  const v = props.value;
  const [enabled, setEnabled] = useState(v.enabled);
  const [hour, setHour] = useState(String(v.send_hour));
  const [d, setD] = useState({ pb: v.paid_days_before.join(", "), pa: v.paid_days_after.join(", "), tb: v.trial_days_before.join(", "), ta: v.trial_days_after.join(", ") });
  const [tpl, setTpl] = useState(v.templates);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [due, setDue] = useState<{ rows: DueRow[]; recent: LogRow[] } | null>(null);
  useEffect(() => {
    setEnabled(v.enabled); setHour(String(v.send_hour)); setTpl(v.templates);
    setD({ pb: v.paid_days_before.join(", "), pa: v.paid_days_after.join(", "), tb: v.trial_days_before.join(", "), ta: v.trial_days_after.join(", ") });
  }, [v]);
  const loadDue = useCallback(async () => {
    const { status, data } = await props.callApi({ action: "reminders_due" });
    if (status === 200) setDue({ rows: (data["due_today"] ?? []) as DueRow[], recent: (data["recent"] ?? []) as LogRow[] });
  }, [props.callApi]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadDue(); }, [loadDue]);

  const pb = parseDays(d.pb), pa = parseDays(d.pa), tb = parseDays(d.tb), ta = parseDays(d.ta);
  const value = useMemo(() => ({
    enabled, send_hour: Number(hour), paid_days_before: pb ?? [], paid_days_after: pa ?? [], trial_days_before: tb ?? [], trial_days_after: ta ?? [], templates: tpl,
  }), [enabled, hour, pb, pa, tb, ta, tpl]);
  const badDays = pb === undefined || pa === undefined || tb === undefined || ta === undefined;
  const r = REMINDER_SCHEMA.safeParse(value);
  const error = badDays ? "Days must be whole numbers separated by commas, for example 7, 3, 1." : hour.trim() === "" ? "Choose the hour." : r.success ? null : (r.error.issues[0]?.message ?? "Check the settings.");

  async function test(kind: ReminderKind) {
    setTesting(kind); setTestMsg(null);
    const { status, data } = await props.callApi({ action: "send_test_reminder", kind });
    setTesting(null);
    setTestMsg(status === 200 ? { ok: true, text: `Test email sent to ${String(data["sent_to"])}. It uses the wording you last SAVED.` } : { ok: false, text: String(data["error"] ?? "The test was not sent.") });
  }
  const dayField = (id: keyof typeof d, label: string, hint: string) => (
    <div className="grid gap-1">
      <Label htmlFor={`rem-${id}`}>{label}</Label>
      <Input id={`rem-${id}`} value={d[id]} onChange={(e) => setD((x) => ({ ...x, [id]: e.target.value }))} placeholder="none" />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );

  return (
    <Card k="reminders" props={props} saver={saver} error={error}
      onSave={() => saver.run({ action: "save_setting", value }, enabled ? "Saved. Reminders are ON." : "Saved. Reminders are OFF.")}
      onReset={() => saver.run({ action: "reset_setting" }, "Reminder settings reset. They are OFF.")}>
      <p className="text-sm text-muted-foreground">
        Emails the owners of a business before their plan or free trial ends, and just after. It checks every hour and only sends in the hour you choose (Nigeria time),
        once per business per day. Only owners and supa admins with an email address are emailed.
      </p>
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Reminders are {enabled ? "ON" : "OFF"}
      </label>
      {enabled && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Before you switch this on, send yourself a test email below and check it arrives. Switching it on emails real customers.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="rem-hour">Send at (hour, Nigeria time, 0 to 23)</Label>
          <Input id="rem-hour" inputMode="numeric" value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ""))} />
          <span className="text-xs text-muted-foreground">9 means 9am.</span>
        </div>
        {dayField("pb", "Paid plan: days before the end date", "For example 7, 3, 1. 1 means the end date is tomorrow. 0 means it ends today.")}
        {dayField("pa", "Paid plan: days after it ended", "For example 1 (the day after). Leave blank for none.")}
        {dayField("tb", "Free trial: days before the end date", "For example 2, 1.")}
        {dayField("ta", "Free trial: days after it ended", "Blank for none.")}
      </div>
      {REMINDER_KINDS.map((k) => (
        <div key={k} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{KIND_LABEL[k]}</span>
            <Button type="button" size="sm" variant="outline" disabled={testing !== null} onClick={() => test(k)}>{testing === k ? "Sending…" : "Email me a test"}</Button>
          </div>
          <Input aria-label={`${KIND_LABEL[k]} subject`} value={tpl[k].subject} onChange={(e) => setTpl((t) => ({ ...t, [k]: { ...t[k], subject: e.target.value } }))} />
          <textarea aria-label={`${KIND_LABEL[k]} message`} rows={5} className="w-full rounded-md border border-input bg-background p-2 text-sm" value={tpl[k].body}
            onChange={(e) => setTpl((t) => ({ ...t, [k]: { ...t[k], body: e.target.value } }))} />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Placeholders: {REMINDER_PLACEHOLDERS.map((n) => `{${n}}`).join(" ")}. {"{when}"} reads "today", "tomorrow", "in 3 days", "yesterday" or "3 days ago". {"{date}"} is the end date.
        Every email also gets a "Message us on WhatsApp" button.
      </p>
      {testMsg && <p className={`text-sm ${testMsg.ok ? "text-foreground" : "text-destructive"}`}>{testMsg.text}</p>}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-sm font-medium text-foreground">Due today</div>
        {due === null ? <p className="text-xs text-muted-foreground">Loading…</p> : due.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody is due a reminder today under the saved settings.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {due.rows.map((x) => (
              <li key={x.business_id} className="flex flex-wrap justify-between gap-2 p-2">
                <span className="text-foreground">{x.name} <span className="text-muted-foreground">({KIND_LABEL[x.kind]}, {x.offset} day{x.offset === 1 ? "" : "s"})</span></span>
                <span className={x.owner_emails > 0 ? "text-muted-foreground" : "font-medium text-destructive"}>
                  {x.owner_emails > 0 ? `${x.owner_emails} owner email${x.owner_emails === 1 ? "" : "s"}` : "No owner email, message them on WhatsApp"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="text-sm font-medium text-foreground">Recently sent</div>
        {due && due.recent.length === 0 ? <p className="text-xs text-muted-foreground">Nothing sent yet.</p> : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {(due?.recent ?? []).map((l, i) => <li key={i}>{fmt(l.created_at)}: {l.business_name}, {l.kind.replaceAll("_", " ")}, {l.offset_days} day{l.offset_days === 1 ? "" : "s"}, {l.sent} of {l.recipients} delivered</li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}


type Outlet = { source: string; feed_url: string; checked_at: string; last_ok_at: string | null; last_error: string | null; last_item_count: number; last_match_count: number };
type Latest = { title: string; source: string; published_at: string };
type ReadItem = { title: string; matched: boolean };

function NewsCard(props: CardProps & { on: boolean }) {
  const saver = useSaver("news", props);
  const [enabled, setEnabled] = useState(props.on);
  const [status, setStatus] = useState<{ outlets: Outlet[]; stored: number; latest: Latest[]; read: Record<string, ReadItem[]>; readAt: string | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setEnabled(props.on), [props.on]);
  useEffect(() => {
    props.callApi({ action: "news_status" }).then(({ status: s, data }) => {
      if (s === 200) setStatus({ outlets: (data["outlets"] ?? []) as Outlet[], stored: Number(data["stored"] ?? 0), latest: (data["latest"] ?? []) as Latest[], read: (data["read_sample"] ?? {}) as Record<string, ReadItem[]>, readAt: (data["read_at"] as string | null) ?? null });
    });
  }, [props.callApi]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card k="news" props={props} saver={saver} error={null}
      onSave={() => saver.run({ action: "save_setting", value: { enabled } }, enabled ? "Saved. News watch is ON." : "Saved. News watch is OFF.")}
      onReset={() => saver.run({ action: "reset_setting" }, "Reset. News watch is ON.")}>
      <p className="text-sm text-muted-foreground">
        Every hour the server reads the news feeds of Punch, Vanguard, BusinessDay, Premium Times, Nairametrics and Daily Trust, and keeps headlines about fuel, transport, rice, pepper, tomatoes and onions
        that also mention a price. Only the headline, outlet, date and link are stored, and nothing changes any cost. Each business can also turn it off for itself.
      </p>
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> News watch is {enabled ? "ON" : "OFF"} for the whole platform
      </label>
      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-sm font-medium text-foreground">Outlets {status ? `(${status.stored} headlines stored)` : ""}</div>
        {status === null ? <p className="text-xs text-muted-foreground">Loading…</p> : status.outlets.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing has run yet. The hourly job has to be scheduled first.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {status.outlets.map((o) => (
              <li key={o.source} className="flex flex-wrap justify-between gap-2 p-2">
                <span className="text-foreground">{o.source}</span>
                <span className={o.last_error ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {o.last_error ? `Last read failed: ${o.last_error}` : `Read ${o.last_item_count} items, ${o.last_match_count} matched`}
                  {o.last_ok_at ? ` · last worked ${fmt(o.last_ok_at)}` : ""}
                </span>
                {(status.read[o.source]?.length ?? 0) > 0 && (
                  <div className="w-full">
                    <button type="button" className="text-xs underline text-muted-foreground" aria-expanded={open === o.source} onClick={() => setOpen(open === o.source ? null : o.source)}>
                      {open === o.source ? "Hide what was read" : "What was read"}
                    </button>
                    {open === o.source && (
                      <ul className="mt-1 space-y-1 text-xs" data-testid={`read-${o.source}`}>
                        {status.read[o.source]!.map((r, i) => (
                          <li key={i} className={r.matched ? "text-foreground" : "text-muted-foreground"}>
                            {r.matched ? "Kept: " : "Skipped: "}{r.title}
                          </li>
                        ))}
                        <li className="text-muted-foreground">The newest headlines from this feed at the last read{status.readAt ? ` (${fmt(status.readAt)})` : ""}. A headline is kept only if it is about fuel, transport, rice, pepper, tomatoes or onions and mentions a price.</li>
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {status && status.latest.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">{status.latest.map((l, i) => <li key={i}>{l.source}: {l.title}</li>)}</ul>
        )}
      </div>
    </Card>
  );
}
