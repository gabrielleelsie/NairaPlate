# Roadmap

- [x] Centralize the exact 18 market-unit values and labels.
- [x] Apply shared labels to every market-unit dropdown and visible value.
- [x] Verify all requested screens and save screenshot evidence.
- [x] Log and verify one new milk-cup purchase.

## Subscriptions (7-day trial, paid plans, lockout)
- [x] Step 2: migration written
- [x] Step 3: migration applied on live database; all 7 checks passed
- [x] Step 4: code built (gate, locked screen, payments, admin UI) — user releases via Release to main
- [ ] Live test with business "zz-test-delete" — needs the released code on the live site

## Offline Phase 0 (approved with amendments, 4 Oct 2026)
- [x] Build Phase 0 code (connection bar, drafts, save-once, paper form)

- [x] Owner ran SQL + check (1,1,6,false,false,0) on 4 Oct 2026
- [x] Phase 0 UAT cases UAT-OFF-01..15 added to /uat and Word export
- [ ] Run UAT-OFF-01..07 in preview with real network cuts (blocker: owner/tester on a phone)
- [x] Module D + release gate added to Owner UAT script, master spec (8.4) and system checklist
- [x] Till keeps expired drafts as "Expired — not saved" (print, owner review form, discard; 7-day purge)
- Decided: customer name/phone kept in drafts for credit sales only; removed on save, discard or expiry.

## Next: Dish price history, then Phase 1 late entry (requested 4 Oct 2026)
- [x] Step 2 code: dish price history panel, Till/Recipes refresh, UAT-OWN-07
- [ ] Step 2 SQL 20261031_dish_prices_a run + check by owner (blocker: owner runs it), then release
- [x] Step 3: closed-shift late-cash policy approved as written (4 Oct 2026)
- [x] Step 4: late_entries SQL run + check confirmed by owner (4 Oct 2026)
- [x] Step 5: Paper sales screen (cashier entry, owner approve/reject/shift review), Late entry label on Orders
- [ ] Steps 6-9: UAT-LATE-01..10 run, rehearsal, pilot (blocker: owner/tester)
- Blocked for Phase 1 start: Phase 0 real-device UAT (owner/tester)

## Paper-sale food cost at the actual sale time (plan approved with 4 refinements, 5 Oct 2026)
- [x] Live definitions received (5 Oct 2026)
- [x] 20261105_late_entry_cost_at (+check, rehearsal 14/14, rollback) verified on practice copy
- [ ] Owner runs script 1, check, rehearsal on live (blocker: owner)
- [x] Owner screen (cost status, hold, estimate with reason), Orders label, UAT-OWN-08
- [ ] Release to main after live check + rehearsal are clean (blocker: owner)
- [x] Accountant CSV exports (/exports) — built; check totals against Report/Drawer pages on live data after release
