// Turns a spoken purchase ("five derica garri four five hundred") into form fields.
// Anything it isn't confident about is returned as null so the form leaves it blank.

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, a: 1, an: 1,
};
const MULT: Record<string, number> = { hundred: 100, thousand: 1000, k: 1000, grand: 1000 };

// Spoken word(s) → stored market_unit
const UNIT_WORDS: [string[], string][] = [
  [["paint", "rubber"], "paint_rubber"], [["paint", "bucket"], "paint_rubber"],
  [["derica"], "derica"], [["mudu"], "mudu"], [["tuber"], "tuber"], [["bag"], "bag"],
  [["carton"], "carton"], [["bottle"], "bottle"], [["bunch"], "bunch"], [["cup"], "cup"],
  [["congo"], "congo"], [["tia"], "tia"],
];
const FILLER = new Set(["of", "at", "for", "naira", "market", "and", "the", "bought", "paid", "from", "each"]);

export type ParsedPurchase = {
  qty: number | null;
  market_unit: string | null;
  ingredient_id: string | null;
  ingredient_heard: string | null;
  total_naira: number | null;
};

const singular = (w: string) => (w.length > 3 && w.endsWith("es") && /(ch|sh|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

function numVal(t: string): number | null {
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return t in ONES && t !== "a" && t !== "an" ? ONES[t] : null;
}
const isNumTok = (t: string) => numVal(t) !== null || t in MULT;

/** Price from number tokens. Returns null when the pattern is ambiguous. */
export function parsePrice(toks: string[]): number | null {
  if (toks.length === 0) return null;
  // "4500" / "50000" — a single numeric string is literal
  if (toks.length === 1 && /^\d+$/.test(toks[0])) return Number(toks[0]);
  // "50k" as one token
  if (toks.length === 1 && /^\d+k$/.test(toks[0])) return Number(toks[0].slice(0, -1)) * 1000;
  // "four five" → 4500 (market slang: thousands, hundreds)
  if (toks.length === 2 && toks.every((t) => { const v = numVal(t); return v !== null && v >= 1 && v <= 9 && !/^\d/.test(t); })) {
    return numVal(toks[0])! * 1000 + numVal(toks[1])! * 100;
  }
  // "four five hundred" → 4500
  if (toks.length === 3) {
    const a = numVal(toks[0]!), b = numVal(toks[1]!);
    if (a !== null && a >= 1 && a <= 9 && b !== null && b >= 1 && b <= 9 && toks[2] === "hundred") return a * 1000 + b * 100;
  }
  // Compositional: "four thousand five hundred", "fifty k", "one hundred and twenty thousand"
  let total = 0, cur = 0, sawAny = false;
  for (const t of toks) {
    const v = numVal(t);
    if (v !== null) { cur += v; sawAny = true; continue; }
    if (t === "hundred") { cur = (cur || 1) * 100; continue; }
    if (t in MULT) { total += (cur || 1) * MULT[t]!; cur = 0; continue; }
    return null;
  }
  const out = total + cur;
  // A bare small number like "forty five" with no multiplier is ambiguous (₦45? ₦4,500?) — leave blank.
  if (!sawAny || out < 100) return null;
  return out;
}

function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
  return d[a.length]![b.length]!;
}
const similarity = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

export function parsePurchase(transcript: string, ingredients: { id: string; name: string }[]): ParsedPurchase {
  const toks = transcript.toLowerCase().replace(/[₦,]/g, "").replace(/(\d)\s*k\b/g, "$1k").split(/[^a-z0-9.]+/).filter(Boolean);
  const used = new Set<number>();

  // Quantity: first number token
  let qty: number | null = null;
  const qi = toks.findIndex((t) => numVal(t) !== null || t === "a" || t === "an");
  if (qi >= 0) { qty = t0(toks[qi]!); used.add(qi); }
  function t0(t: string) { return t === "a" || t === "an" ? 1 : numVal(t); }

  // Unit
  let market_unit: string | null = null;
  for (let i = 0; i < toks.length && !market_unit; i++) {
    for (const [words, unit] of UNIT_WORDS) {
      if (words.every((w, k) => toks[i + k] !== undefined && singular(toks[i + k]!) === w)) {
        market_unit = unit; words.forEach((_, k) => used.add(i + k)); break;
      }
    }
  }

  // Price: number tokens after the quantity (and after the ingredient words)
  const priceToks: string[] = [];
  const priceIdx: number[] = [];
  toks.forEach((t, i) => { if (!used.has(i) && i > qi && (isNumTok(t) || /^\d+k$/.test(t))) { priceToks.push(t); priceIdx.push(i); } });
  const total_naira = parsePrice(priceToks);
  priceIdx.forEach((i) => used.add(i));

  // Ingredient: fuzzy-match remaining words (singles and pairs) against names
  const rest = toks.filter((t, i) => !used.has(i) && !FILLER.has(t) && !(t in ONES) && !(t in MULT));
  const candidates = [...rest, ...rest.slice(0, -1).map((t, i) => `${t} ${rest[i + 1]}`)];
  let best: { id: string; score: number; heard: string } | null = null;
  for (const ing of ingredients) {
    const name = ing.name.toLowerCase();
    for (const c of candidates) {
      const s = Math.max(similarity(c, name), similarity(singular(c), name), ...name.split(/\s+/).map((w) => similarity(c, w)));
      if (!best || s > best.score) best = { id: ing.id, score: s, heard: c };
    }
  }
  const ok = best && best.score >= 0.75;
  return {
    qty, market_unit,
    ingredient_id: ok ? best!.id : null,
    ingredient_heard: best?.heard ?? (rest[0] ?? null),
    total_naira,
  };
}
