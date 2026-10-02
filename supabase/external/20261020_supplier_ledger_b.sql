-- NairaPlate append-only records, step 2, part B: close the old direct write path to supplier entries.
-- Run ONLY AFTER the new supplier screens are live (they record payments through record_supplier_payment). Safe to re-run.
-- Rollback: 20261020_supplier_ledger_b_rollback.sql
drop policy if exists supplier_transactions_insert on public.supplier_transactions;
drop policy if exists supplier_transactions_update on public.supplier_transactions;
