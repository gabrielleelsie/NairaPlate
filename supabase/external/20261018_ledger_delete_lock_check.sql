-- Read-only. Expect: delete_policies_left 0 (on these seven tables), other_delete_policies_untouched 10.
select
  (select count(*) from pg_policies where schemaname='public' and cmd='DELETE' and tablename in ('order_adjustments','customer_credits','purchases','supplier_transactions','cash_drawers','channel_payouts','staff_users')) as delete_policies_left,
  (select count(*) from pg_policies where schemaname='public' and cmd='DELETE' and tablename not in ('order_adjustments','customer_credits','purchases','supplier_transactions','cash_drawers','channel_payouts','staff_users')) as other_delete_policies_untouched;
