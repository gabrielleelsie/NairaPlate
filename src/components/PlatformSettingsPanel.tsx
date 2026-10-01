import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_SETTINGS, PLACEHOLDERS, SETTING_LABEL, SETTING_SCHEMAS, bannerWhen, formatPrice, nairaTextToKobo, renderTemplate,
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
  const [custom, setCustom] = useState<string[]>([]);
  const [meta, setMeta] = useState<Meta>({});
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { status, data } = await callApi({ action: "get_settings" });
    if (status !== 200) return setErr(String(data["error"] ?? "Could not load settings."));
    setSettings(data["settings"] as PlatformSettings);
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
    </div>
  );
}

type CardProps = { callApi: Api; custom: string[]; meta: Meta; reload: () => Promise<void> };

function useSaver(k: SettingKey, { callApi, reload }: CardProps) {
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
  k: SettingKey; props: CardProps; saver: ReturnType<typeof useSaver>; children: React.ReactNode;
  onSave: () => void; onReset: () => void; error: string | null;
}) {
  const isCustom = props.custom.includes(k);
  const m = props.meta[k];
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid={`setting-${k}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-card-foreground">{SETTING_LABEL[k]}</h2>
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

function PricesCard(props: CardProps & { value: PlatformSettings["prices"] }) {
  const saver = useSaver("prices", props);
  const [t, setT] = useState({ monthly: kobo2text(props.value.monthly_kobo), quarterly: kobo2text(props.value.quarterly_kobo), yearly: kobo2text(props.value.yearly_kobo) });
  useEffect(() => setT({ monthly: kobo2text(props.value.monthly_kobo), quarterly: kobo2text(props.value.quarterly_kobo), yearly: kobo2text(props.value.yearly_kobo) }), [props.value]);
  const parsed = { monthly_kobo: nairaTextToKobo(t.monthly), quarterly_kobo: nairaTextToKobo(t.quarterly), yearly_kobo: nairaTextToKobo(t.yearly) };
  const bad = Object.values(parsed).includes(undefined);
  const result = bad ? null : SETTING_SCHEMAS.prices.safeParse(parsed);
  const error = bad ? "Enter prices as numbers, for example 15000 or 15,000.50. Leave a plan blank to show no price." : result && !result.success ? (result.error.issues[0]?.message ?? "Check the prices.") : null;
  return (
    <Card k="prices" props={props} saver={saver} error={error}
      onSave={() => saver.run({ action: "save_setting", value: parsed }, "Prices saved. Customers see them on the locked screen.")}
      onReset={() => saver.run({ action: "reset_setting" }, "Prices cleared. No price is shown.")}>
      <p className="text-sm text-muted-foreground">Shown on the locked screen. Leave a plan blank and no price is shown for it. A price is never invented.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["monthly", "quarterly", "yearly"] as const).map((p) => (
          <div key={p} className="grid gap-1">
            <Label htmlFor={`price-${p}`} className="capitalize">{p} (₦)</Label>
            <Input id={`price-${p}`} inputMode="decimal" value={t[p]} onChange={(e) => setT((x) => ({ ...x, [p]: e.target.value }))} placeholder="not set" />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Preview: {(["monthly", "quarterly", "yearly"] as const).map((p) => `${p[0]!.toUpperCase()}${p.slice(1)} ${formatPrice(parsed[`${p}_kobo`] ?? null) ?? "(no price)"}`).join(" · ")}
      </p>
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
