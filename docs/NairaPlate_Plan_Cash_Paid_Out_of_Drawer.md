# NairaPlate plan: cash paid out of the drawer

**Status:** plan for approval. Nothing is built or changed yet.
**Date:** 3 October 2026
**Why:** expected cash in a drawer only counts money coming in. When a cashier hands drawer cash to someone for a market run, gas or a supplier, the shift shows a shortage and raises an alert, even though the cashier did nothing wrong. This plan makes cash going out a recorded, reversible, audited entry, in the same style as the other ledgers.

---

## 1. Your decisions (3 October 2026) and how this plan applies them

| Decision | How it is applied |
|---|---|
| Cashiers record routine cash-outs up to an owner-set limit; above it the owner approves or an Owner logs it | Section 3 and 4 |
| Purchases and supplier settlements reduce expected cash only if "Paid from drawer" is ticked | Section 5 |
| Catering deposits carry a payment method in the same step | Section 6 |
| Offline resilience gets its own scoping document | Separate PDF |

## 2. What changes in the sum

Today: **expected cash = float + cash sales (net of part refunds) + cash catering payments + cash debt payments.**

After this step: **expected cash = float + cash sales + cash catering payments (now including deposits that carry a cash method) + cash debt payments − cash paid out.**

"Cash paid out" is the total of payout entries on that shift, minus any that an owner reversed. The sum stays in the one place it lives today (`src/lib/cash-drawer.ts`), and a closed shift keeps the breakdown it was worked out from, with a new line "Paid out". Closed shifts from before this step are not restated.

## 3. The payout entry (database)

A new append-only table, `cash_drawer_payouts`, belongs to one shift. Nobody signed in can write, edit or delete it directly. Only database functions write to it.

| Entry kind | Meaning | Counts in expected cash? |
|---|---|---|
| payout | Cash left the drawer and is approved | Yes (minus) |
| request | A cashier asked for a payout above the limit | No, until approved |
| approval | The owner approved a request: this is a payout row tied to the request | Yes (minus) |
| decline | The owner declined a request | No |
| reversal | The owner cancelled a payout (reason of 5+ characters). Carries a minus amount | Cancels the payout |

Each entry stores: amount, category, a note (5+ characters), who, when, and the link to what it cancels or approves. A request is never changed. It is settled by a new row that points at it, and the database allows only one settling row per request.

**Categories:** market run, gas or fuel, transport, supplier settlement, other (the note must say what for). Payouts created from a purchase or supplier payment carry that link instead (Section 5).

**Rules the database enforces:**
- A payout can only attach to the single open shift. No open shift means "Open a shift first".
- Amount above zero. Note of 5+ characters. Reversal needs a reason of 5+ characters, owner only, once per payout.
- A shift **cannot be closed while a request is waiting**. The owner approves or declines it first. This applies to every close, including an owner closing a shift someone left open, so the numbers always agree.
- Cashier: may record a payout directly while the running total of payouts they recorded on this shift stays within the limit. The first one that would pass it becomes a **request** instead. (Using the shift's running total stops a cashier getting round the limit by splitting one big payout into several small ones.)
- Owner and Supa Admin: any amount, directly, and may approve, decline and reverse.
- Cook, purchaser and visitors: cannot record a free-standing payout.
- Each business's limit is stored in a small settings table that only a database function can change (owner only, audited). Default ₦10,000.

**Audit lines (new):** cash payout recorded, requested, approved, declined, reversed, and "payout limit changed".

## 4. The screens

**Cash drawer, open shift**
- A new section "Cash taken out" with a button **Take cash out**: amount, category, note.
- A cashier above the limit sees the button change to **Ask the owner**. The request raises an alert for the owner.
- The shift's payouts are listed with who, what and why. Owners see **Reverse** on each.
- Owners see **Waiting for approval** with **Approve** and **Decline**.
- If a request is waiting, **Close shift** is disabled with the reason.

**Closed shifts** show "Paid out" in the breakdown.

**Owner only: Payout limit.** A small field on the Cash drawer page to set the limit.

## 5. Purchases and supplier payments: "Paid from drawer"

- The Purchases screen and the supplier payment screen each get a checkbox, **Paid from the cash drawer**. It is shown when the payment is cash. It is off by default.
- When ticked, the purchase or payment and its payout entry are saved **together or not at all**. If no shift is open, the screen says so and nothing is saved.
- Purchasers and owners may do this at any amount. The purchase itself is the evidence, so no approval step.
- **Reversing the purchase or payment automatically reverses its payout**, with the same reason, in the same step. A purchase that was not paid from the drawer is not touched.
- These two actions use new database functions that call the existing ones (`log_purchase`, `record_supplier_payment`) and add the payout. The released functions are not edited.

## 6. Catering deposits get a payment method

- A deposit taken when the order is created is saved with a method (cash or transfer). The new order form asks for it whenever a deposit is entered.
- A cash deposit is counted in expected cash from then on. Reversals carry the same method, so they net out.
- The two existing deposits have no method and stay uncounted, as today.
- The old order function (without the method) is removed only after the new screen is live, so a deposit can never be saved without a method again.

## 7. Order of work, in the same pattern as earlier steps

| Part | What | When it runs |
|---|---|---|
| A | New table, functions, shift-close guard, settings, catering function with method, deposit rule. Old screens keep working. | Before the screens are released |
| Code | Cash drawer, Purchases, supplier payment and catering screens; expected-cash calculation and the server close route; tests | One release |
| B | Remove the old catering function (no method) | After the screens are live |

Each part comes with a check query and a rollback. The rollback refuses to run once real payout entries exist.

## 8. How it will be tested

1. **Local database copy:** each role (cashier under and over the limit, owner, purchaser, cook, visitor, another business), the running-total rule, request, approve, decline, reverse, the close guard, the purchase and supplier links in both directions, the catering method rule, repeat runs and the rollback.
2. **Unit tests** for the expected-cash sum with payouts, requests, reversals and catering deposits.
3. **A live rehearsal** that undoes itself, added to the existing one.
4. **Screens:** a new section in the UAT scripts, step by step, for the payout, the approval and the checkboxes.

## 9. What this does not do

- It does not stop a cashier taking cash and recording nothing. The count at close will still show that as a shortage, which is correct.
- It does not check the payout against cash in the drawer. A payout bigger than the expected cash makes expected cash negative and the owner sees that.
- Old closed shifts are not restated.

## 10. Questions I need answered before building

1. **Purchaser free-standing payouts.** I have allowed purchasers to take drawer cash out only through the "Paid from drawer" boxes. Do you also want a purchaser to be able to record a free-standing payout, for example a market run with no purchase attached?
2. **The limit.** Per shift running total (my recommendation, it blocks splitting) or per single payout?
3. **The default.** ₦10,000 until the owner changes it. Right?
4. **Categories.** Market run, gas or fuel, transport, supplier settlement, other. Anything to add or remove?
5. **Waiting requests and closing.** I have made a waiting request block every close until the owner decides. Are you happy with that?
