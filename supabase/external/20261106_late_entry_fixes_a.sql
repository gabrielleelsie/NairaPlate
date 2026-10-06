-- NairaPlate: two fixes to paper (late) entries, found by reading the LIVE functions on 5 October 2026.
-- Run once in the Supabase SQL editor of the LIVE project. Safe to re-run. Check: 20261106_late_entry_fixes_a_check.sql. Undo: 20261106_late_entry_fixes_a_rollback.sql
-- Needs 20261101_late_entries_a.sql and 20261105_late_entry_cost_at.sql.
--
-- FIX 1 (invented price). submit_late_entry ended each price lookup with  coalesce(price, 150000), a hard-coded 1,500.00 naira
--   used when no price could be found at all. A paper sale must never get a price nobody set. It now refuses and names the dish.
-- FIX 2 (D6, closed-shift adjustments). approve_and_post_late_entry added the "late cash" adjustment to a closed shift without the rules
--   that adjust_closed_drawer applies: the shift must be closed and must have a count. It now checks both, records the person's name
--   and writes the same audit line.
-- Method: each function is read from the live database, the exact old text is replaced, and the function is saved again.
--   If the old text is not found (someone changed the function since), the script stops and changes nothing.

begin;

do $fix$
declare
  d text; n text;
  old1 constant text := 'v_unit_price := coalesce(v_unit_price, 150000);';
  new1 constant text := 'IF v_unit_price IS NULL OR v_unit_price <= 0 THEN RAISE EXCEPTION ''No price is on record for "%" at the time of this sale. Ask the owner to set a price first.'', v_dish_name; END IF;';
  old2 constant text := E'insert into public.cash_drawer_adjustments (\n        business_id, drawer_id, amount_kobo, reason, recorded_by\n      ) values (\n        v_biz, e.source_shift_id, e.cash_kobo,\n        format(''Late cash from paper ref %s'', e.paper_reference), v_uid\n      );';
  new2 constant text := E'declare\n        v_d public.cash_drawers%rowtype; v_nm text;\n      begin\n        select * into v_d from public.cash_drawers where id = e.source_shift_id and business_id = v_biz for update;\n        if not found or v_d.status <> ''closed'' then raise exception ''The shift this sale belongs to is not a closed shift, so late cash cannot be added to it. Choose closed_shift_included instead.''; end if;\n        if v_d.closing_counted_kobo is null then raise exception ''That shift was closed without a count, so there is no count to add late cash to. Choose closed_shift_included instead.''; end if;\n        select display_name into v_nm from public.staff_users where id = v_uid;\n        insert into public.cash_drawer_adjustments (business_id, drawer_id, amount_kobo, reason, recorded_by, recorded_by_name)\n        values (v_biz, e.source_shift_id, e.cash_kobo, format(''Late cash from paper ref %s'', e.paper_reference), v_uid, coalesce(v_nm, ''Owner''));\n        insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)\n        values (v_biz, v_uid, v_role, ''drawer_count_adjusted'', ''cash_drawers'', e.source_shift_id,\n                format(''%s added late cash of %s kobo to a closed shift (paper ref %s)'', coalesce(v_nm, ''Owner''), e.cash_kobo, e.paper_reference));\n      end;';
begin
  -- Fix 1
  d := pg_get_functiondef('public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)'::regprocedure);
  if position(old1 in d) = 0 then
    if position(new1 in d) > 0 then raise notice 'Fix 1 already applied.';
    else raise exception 'submit_late_entry is not the expected version. Nothing was changed.'; end if;
  else
    n := replace(d, old1, new1);
    execute n;
  end if;
  -- Fix 2
  d := pg_get_functiondef('public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure);
  if position(old2 in d) = 0 then
    if position(new2 in d) > 0 then raise notice 'Fix 2 already applied.';
    else raise exception 'approve_and_post_late_entry is not the expected version. Nothing was changed.'; end if;
  else
    n := replace(d, old2, new2);
    execute n;
  end if;
end $fix$;

commit;
