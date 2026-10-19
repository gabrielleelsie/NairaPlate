import { describe, expect, it } from "vitest";
import { emailWarning } from "./email-notice";

describe("emailWarning", () => {
  it("says nothing when the email went out, or the server did not say", () => {
    expect(emailWarning({ ok: true, owner_emailed: true })).toBeNull();
    expect(emailWarning({ ok: true })).toBeNull();
    expect(emailWarning()).toBeNull();
  });
  it("warns with the reason when the email did not send", () => {
    expect(emailWarning({ owner_emailed: false, email_note: "the owner has no email address on file" }))
      .toBe("The owner's email did not send (the owner has no email address on file). Please tell them yourself.");
  });
  it("warns when either step failed, and does not repeat the same reason", () => {
    const w = emailWarning({ owner_emailed: true }, { owner_emailed: false, email_note: "A" }, { owner_emailed: false, email_note: "A" }, { owner_emailed: false, email_note: "B" });
    expect(w).toBe("The owner's email did not send (A; B). Please tell them yourself.");
  });
  it("still warns when no reason is given", () => {
    expect(emailWarning({ owner_emailed: false })).toContain("reason not given");
  });
});
