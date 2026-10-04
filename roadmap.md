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
- [ ] Owner runs supabase/external/20261030_sale_once_a.sql + check BEFORE release (blocker: owner action)
- [ ] Real-device tests (Android, airplane mode, weak network); add Phase 0 to UAT scripts and spec
- Decided: customer name/phone kept in drafts for credit sales only; removed on save, discard or expiry.
