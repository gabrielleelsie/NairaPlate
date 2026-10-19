// What the admin screen says about the owner's email after approving a store or recording a payment.
// The server answers owner_emailed (true or false) and, when false, email_note (why). An answer without owner_emailed is treated as fine.

/** A warning when any step could not email the owner, or null when every email went out. */
export function emailWarning(...results: Record<string, unknown>[]): string | null {
  const notes: string[] = [];
  for (const r of results) {
    if (r["owner_emailed"] !== false) continue;
    const n = typeof r["email_note"] === "string" && r["email_note"].trim() ? r["email_note"].trim() : "reason not given";
    if (!notes.includes(n)) notes.push(n);
  }
  return notes.length === 0 ? null : `The owner's email did not send (${notes.join("; ")}). Please tell them yourself.`;
}
