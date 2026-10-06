-- Self-undoing rehearsal. Saves nothing: it ends with a deliberate error, so the editor shows a red "Failed to run sql query".
-- Read the message: "REHEARSAL DONE. NOTHING WAS SAVED. ALL CLEAR" is a pass. Run it after 20261114_payment_columns_a.sql.
do $r$
declare
  biz text; passed int := 0; failed int := 0; msgs text := ''; n bigint; rid uuid := gen_random_uuid();
begin
  select id into biz from public.businesses where id = 'demo-kitchen';
  if biz is null then raise exception 'REHEARSAL STOPPED. demo-kitchen was not found, nothing was tested.'; end if;

  -- 1. a normal payment with a plan type and no setup fee
  begin
    insert into public.subscription_payments (id, business_id, plan, amount_kobo, payment_reference, paid_on, period_start, period_end, recorded_by, operating_mode)
    values (rid, biz, 'monthly', 1000000, 'REHEARSAL-1', date '2019-01-01', timestamptz '2019-01-01', timestamptz '2019-01-31', gen_random_uuid(), 'standard');
    select setup_fee_kobo into n from public.subscription_payments where id = rid;
    if n = 0 then passed := passed + 1; else failed := failed + 1; msgs := msgs || E'\nFAIL 1: setup default is not 0'; end if;
  exception when others then failed := failed + 1; msgs := msgs || E'\nFAIL 1: ' || sqlerrm; end;

  -- 2. a payment that includes the setup fee and a reason
  begin
    insert into public.subscription_payments (business_id, plan, amount_kobo, payment_reference, paid_on, period_start, period_end, recorded_by, operating_mode, setup_fee_kobo, difference_reason)
    values (biz, 'monthly', 2500000, 'REHEARSAL-2', date '2019-01-01', timestamptz '2019-01-01', timestamptz '2019-01-31', gen_random_uuid(), 'standard', 1500000, 'rehearsal reason');
    passed := passed + 1;
  exception when others then failed := failed + 1; msgs := msgs || E'\nFAIL 2: ' || sqlerrm; end;

  -- 3. an unknown plan type is refused
  begin
    insert into public.subscription_payments (business_id, plan, amount_kobo, payment_reference, paid_on, period_start, period_end, recorded_by, operating_mode)
    values (biz, 'monthly', 1000000, 'REHEARSAL-3', date '2019-01-01', timestamptz '2019-01-01', timestamptz '2019-01-31', gen_random_uuid(), 'gold');
    failed := failed + 1; msgs := msgs || E'\nFAIL 3: unknown plan type was accepted';
  exception when check_violation then passed := passed + 1; when others then failed := failed + 1; msgs := msgs || E'\nFAIL 3: ' || sqlerrm; end;

  -- 4. a setup fee larger than the amount paid is refused
  begin
    insert into public.subscription_payments (business_id, plan, amount_kobo, payment_reference, paid_on, period_start, period_end, recorded_by, setup_fee_kobo)
    values (biz, 'monthly', 1000000, 'REHEARSAL-4', date '2019-01-01', timestamptz '2019-01-01', timestamptz '2019-01-31', gen_random_uuid(), 2000000);
    failed := failed + 1; msgs := msgs || E'\nFAIL 4: setup fee above the amount was accepted';
  exception when check_violation then passed := passed + 1; when others then failed := failed + 1; msgs := msgs || E'\nFAIL 4: ' || sqlerrm; end;

  -- 5. a negative setup fee is refused
  begin
    insert into public.subscription_payments (business_id, plan, amount_kobo, payment_reference, paid_on, period_start, period_end, recorded_by, setup_fee_kobo)
    values (biz, 'monthly', 1000000, 'REHEARSAL-5', date '2019-01-01', timestamptz '2019-01-01', timestamptz '2019-01-31', gen_random_uuid(), -1);
    failed := failed + 1; msgs := msgs || E'\nFAIL 5: negative setup fee was accepted';
  exception when check_violation then passed := passed + 1; when others then failed := failed + 1; msgs := msgs || E'\nFAIL 5: ' || sqlerrm; end;

  -- 6. a payment with no plan type (as every payment before this change) still saves
  begin
    insert into public.subscription_payments (business_id, plan, amount_kobo, payment_reference, paid_on, period_start, period_end, recorded_by)
    values (biz, 'yearly', 9600000, 'REHEARSAL-6', date '2019-01-01', timestamptz '2019-01-01', timestamptz '2019-12-31', gen_random_uuid());
    passed := passed + 1;
  exception when others then failed := failed + 1; msgs := msgs || E'\nFAIL 6: ' || sqlerrm; end;

  raise exception 'REHEARSAL DONE. NOTHING WAS SAVED. % (% passed, % failed)%', case when failed = 0 then 'ALL CLEAR' else 'ATTENTION' end, passed, failed, msgs;
end
$r$;
