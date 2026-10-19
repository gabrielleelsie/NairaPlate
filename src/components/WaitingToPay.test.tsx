import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WaitingToPay, type WaitingRow } from "./WaitingToPay";

const row: WaitingRow = {
  business_id: "mama-put", business_name: "Mama Put Kitchen", mode: "buka", term: "monthly", chosen_at: "2026-10-19T09:00:00Z",
  business_status: "pending", owner_email: "ada@example.com",
};

describe("WaitingToPay", () => {
  it("says nobody is waiting when the list is empty", () => {
    const html = renderToStaticMarkup(<WaitingToPay items={[]} />);
    expect(html).toContain("Chose a plan, not paid yet");
    expect(html).toContain("Nobody is waiting to pay.");
  });
  it("shows the store, owner email, the plan chosen, its status and an Open store button", () => {
    const html = renderToStaticMarkup(<WaitingToPay items={[row, { ...row, business_id: "b2", business_name: "B Two", business_status: "approved", owner_email: null }]} onOpenStore={() => {}} />);
    expect(html).toContain("Mama Put Kitchen (mama-put)");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("Approved");
    expect(html).toContain("no email");
    expect(html.match(/Open store/g)).toHaveLength(2);
  });
});
