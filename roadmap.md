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
- [ ] Build Phase 0 safe degraded mode per amended plan (waiting on: duplicate-check approach, till label, paper reference format)
- Decided: customer name/phone kept in drafts for credit sales only; removed on save, discard or expiry.
