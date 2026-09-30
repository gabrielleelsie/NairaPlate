# Roadmap

- [x] Centralize the exact 18 market-unit values and labels.
- [x] Apply shared labels to every market-unit dropdown and visible value.
- [x] Verify all requested screens and save screenshot evidence.
- [x] Log and verify one new milk-cup purchase.

## Subscriptions (7-day trial, paid plans, lockout)
- [ ] Step 2: write explicit migration (81 ALTER POLICY, extend businesses_status_guard, DB-side trial start) — blocked on live policy text + guard function body from user
- [ ] Step 3: user runs migration on live database, then the read-only check query
- [ ] Step 4: code release — only after the user confirms Step 3
- [ ] Live test with business "zz-test-delete"; report the audit entries it created
