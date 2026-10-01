// Grade A / B / C: the quality of what was bought. Required on every purchase.
export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

export function isGrade(v: unknown): v is Grade {
  return v === "A" || v === "B" || v === "C";
}

// Pulls a spoken grade ("grade a", "grade b") out of a transcript. Done before parsePurchase,
// because that parser reads the word "a" as the number 1.
export function extractGrade(text: string): { grade: Grade | null; rest: string } {
  const m = /\bgrade\s+(a|b|c|ay|bee|see)\b/i.exec(text);
  if (!m) return { grade: null, rest: text };
  const w = (m[1] ?? "").toLowerCase();
  const grade: Grade = w === "a" || w === "ay" ? "A" : w === "b" || w === "bee" ? "B" : "C";
  return { grade, rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() };
}

export function gradeLabel(g: string | null | undefined): string {
  return isGrade(g) ? `Grade ${g}` : "No grade";
}
