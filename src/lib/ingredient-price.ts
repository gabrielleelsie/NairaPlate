import { isGrade } from "@/lib/grade";
import { isSeason } from "@/lib/season";

// Does saving this ingredient need a grade and a season? Yes when a priced ingredient is added,
// or when the price on an existing one changes. Renaming or changing the reorder level does not.
export function needsGradeAndSeason(opts: { isNew: boolean; savedKobo: number | null; newKobo: number }): boolean {
  if (!(opts.newKobo > 0)) return false;
  if (opts.isNew) return true;
  return Number(opts.savedKobo ?? 0) !== opts.newKobo;
}

// Returns the sentence to show the user, or null when the choice is complete.
export function gradeSeasonProblem(grade: string, season: string): string | null {
  if (!isGrade(grade)) return "Choose the grade this price is for: A, B or C.";
  if (!isSeason(season)) return "Choose the season this price was paid in: Plenty, Normal or Scarce.";
  return null;
}
