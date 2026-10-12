// Wastage history: who may see names, who may delete, and the exact wording.
// The database already decides the real permissions (select: owner, cook, purchaser, supa admin;
// delete: owner and supa admin) and puts stock back when an entry is deleted. These rules only
// decide what the screen shows.

export const WASTAGE_HISTORY_LIMIT = 40;

export type WastageRow = {
  id: string;
  ingredient_id: string;
  qty: number;
  unit: string;
  cost_kobo: number;
  reason: string | null;
  logged_by: string | null;
  created_at: string;
};

const isOwnerRole = (role: string | null | undefined) => role === "owner" || role === "supa_admin";

/** Delete is shown to the owner and supa admin only. */
export const canDeleteWastage = (role: string | null | undefined) => isOwnerRole(role);

/** Staff names can be read by the owner and supa admin only. */
export const canSeeStaffNames = (role: string | null | undefined) => isOwnerRole(role);

/** "Recorded by": the name for the owner and supa admin; "You" or "A team member" for everyone else. */
export function recordedByLabel(
  row: Pick<WastageRow, "logged_by">,
  role: string | null | undefined,
  userId: string | null | undefined,
  names: Record<string, string>,
): string {
  if (canSeeStaffNames(role)) return (row.logged_by && names[row.logged_by]) || "Unknown";
  return row.logged_by && row.logged_by === userId ? "You" : "A team member";
}

export const WASTAGE_HISTORY_HEADING = "Wastage history";
export const WASTAGE_HISTORY_SUBLINE = "Past wastage entries for this kitchen.";
export const WASTAGE_HISTORY_EMPTY = "No wastage entries yet.";
export const WASTAGE_DELETE_BUTTON = "Delete entry";
export const WASTAGE_CONFIRM_TITLE = "Delete this wastage entry?";
export const WASTAGE_CONFIRM_TEXT =
  "Removing this entry will return the wasted stock to inventory and record “Wastage entry removed” in the stock trail.";
export const WASTAGE_NO_STOCK_RECORD_NOTE =
  "This entry was recorded before stock records existed, so deleting it will not change stock.";
export const WASTAGE_REMOVED_MESSAGE =
  "Wastage entry removed. Stock has been returned to inventory.";

/** The paragraphs of the confirmation. The second one appears only for an entry with no stock record. */
export const confirmParagraphs = (hasStockRecord: boolean): string[] =>
  hasStockRecord ? [WASTAGE_CONFIRM_TEXT] : [WASTAGE_CONFIRM_TEXT, WASTAGE_NO_STOCK_RECORD_NOTE];

export const removeFailedMessage = (databaseMessage: string | null | undefined) =>
  `Not removed: ${databaseMessage && databaseMessage.trim() ? databaseMessage.trim() : "you may not have permission, or it was already removed."}`;
