-- Supplier payment method, part B: the old way of paying a supplier (no method) is removed.
-- Run ONLY AFTER the new Pay a supplier screen is live (it calls record_supplier_payment_v2) and has been used once. Safe to re-run.
-- Rollback: 20261029_supplier_method_b_rollback.sql
drop function if exists public.record_supplier_payment(uuid, bigint, text);
