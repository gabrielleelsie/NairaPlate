import { describe, expect, it } from "vitest";
import {
  WASTAGE_CONFIRM_TEXT,
  WASTAGE_HISTORY_LIMIT,
  WASTAGE_NO_STOCK_RECORD_NOTE,
  canDeleteWastage,
  canSeeStaffNames,
  confirmParagraphs,
  recordedByLabel,
  removeFailedMessage,
} from "./wastage-history";

describe("who can delete a wastage entry", () => {
  it("is the owner and supa admin only", () => {
    expect(canDeleteWastage("owner")).toBe(true);
    expect(canDeleteWastage("supa_admin")).toBe(true);
    for (const r of ["cook", "purchaser", "cashier", "", null, undefined])
      expect(canDeleteWastage(r)).toBe(false);
  });
});

describe("recorded by", () => {
  const names = { u1: "Ada Cook", u2: "Demo Purchaser" };
  it("shows the staff name to the owner and supa admin", () => {
    expect(recordedByLabel({ logged_by: "u2" }, "owner", "u9", names)).toBe("Demo Purchaser");
    expect(recordedByLabel({ logged_by: "u1" }, "supa_admin", "u9", names)).toBe("Ada Cook");
    expect(canSeeStaffNames("owner")).toBe(true);
  });
  it("shows Unknown to the owner when the person cannot be found", () => {
    expect(recordedByLabel({ logged_by: "gone" }, "owner", "u9", names)).toBe("Unknown");
    expect(recordedByLabel({ logged_by: null }, "owner", "u9", names)).toBe("Unknown");
  });
  it("shows a cook or purchaser “You” on their own entries and “A team member” on others, never a name", () => {
    expect(recordedByLabel({ logged_by: "u2" }, "purchaser", "u2", names)).toBe("You");
    expect(recordedByLabel({ logged_by: "u1" }, "purchaser", "u2", names)).toBe("A team member");
    expect(recordedByLabel({ logged_by: "u1" }, "cook", "u1", names)).toBe("You");
    expect(recordedByLabel({ logged_by: null }, "cook", "u1", names)).toBe("A team member");
    expect(canSeeStaffNames("cook")).toBe(false);
    expect(canSeeStaffNames("purchaser")).toBe(false);
  });
  it("does not say You when the signed-in user is unknown", () => {
    expect(recordedByLabel({ logged_by: "u1" }, "cook", null, names)).toBe("A team member");
    expect(recordedByLabel({ logged_by: "u1" }, "cook", undefined, names)).toBe("A team member");
  });
});

describe("the confirmation", () => {
  it("has one paragraph when the entry has a stock record", () => {
    expect(confirmParagraphs(true)).toEqual([WASTAGE_CONFIRM_TEXT]);
  });
  it("adds the no-stock-record paragraph only when there is none", () => {
    expect(confirmParagraphs(false)).toEqual([WASTAGE_CONFIRM_TEXT, WASTAGE_NO_STOCK_RECORD_NOTE]);
    expect(WASTAGE_NO_STOCK_RECORD_NOTE).toBe(
      "This entry was recorded before stock records existed, so deleting it will not change stock.",
    );
  });
});

describe("messages and limits", () => {
  it("passes the database message through", () => {
    expect(removeFailedMessage("new row violates row-level security")).toBe(
      "Not removed: new row violates row-level security",
    );
  });
  it("gives a plain reason when there is no database message", () => {
    expect(removeFailedMessage(null)).toBe(
      "Not removed: you may not have permission, or it was already removed.",
    );
    expect(removeFailedMessage("   ")).toBe(
      "Not removed: you may not have permission, or it was already removed.",
    );
  });
  it("shows the latest 40 entries", () => expect(WASTAGE_HISTORY_LIMIT).toBe(40));
});
