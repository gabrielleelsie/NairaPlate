-- Undo 20261107_paper_rules_a.sql. Refuses to drop the confirmations table while it holds records (they are audit evidence),
-- and refuses to remove "outside_shift_cash" while an entry uses it.
begin;
do $undo$
declare
  d text;
  o1 constant text := $o1$  v_decision    text;
begin$o1$;
  n1 constant text := $n1$  v_decision    text;
  v_src         public.cash_drawers%rowtype;
begin$n1$;
  o2 constant text := $o2$  -- Determine shift context
  select id into v_cur_open_shift from public.cash_drawers where business_id = v_biz and status = 'open' limit 1;

  if e.status = 'needs_shift_review' or v_cur_open_shift is null then
    if p_shift_resolution not in ('closed_shift_included', 'closed_shift_late_cash') then$o2$;
  n2 constant text := $n2$  -- Shift context: the shift the sale really happened in (fixed when the entry was sent), and whether it is still open.
  select * into v_src from public.cash_drawers where id = e.source_shift_id and business_id = v_biz;

  if e.source_shift_id is null then
    if p_shift_resolution is distinct from 'outside_shift_cash' then
      raise exception 'This sale is outside any shift. Reject it, or approve it as outside_shift_cash with a reason.';
    end if;
    if length(btrim(coalesce(p_notes, ''))) < 5 then
      raise exception 'Type a reason of at least 5 characters for cash outside any shift.';
    end if;
    v_resolution := 'outside_shift_cash';
  elsif v_src.status is distinct from 'open' then
    if p_shift_resolution is null or p_shift_resolution not in ('closed_shift_included', 'closed_shift_late_cash') then$n2$;
  o3 constant text := $o3$    v_resolution := p_shift_resolution;
$o3$;
  n3 constant text := $n3$    if length(btrim(coalesce(p_notes, ''))) < 5 then
      raise exception 'Type a reason of at least 5 characters for this closed-shift choice.';
    end if;
    v_resolution := p_shift_resolution;
$n3$;
  o4 constant text := $o4$  if e.payment_method = 'transfer' then$o4$;
  n4 constant text := $n4$  if e.payment_method in ('transfer', 'split') then$n4$;
  o5 constant text := $o5$  if o.status <> 'awaiting_payment' then raise exception 'Only an order that is still waiting for the bank can be cancelled here.'; end if;$o5$;
  n5 constant text := $n5$  if o.status <> 'awaiting_payment' then raise exception 'Only an order that is still waiting for the bank can be cancelled here.'; end if;
  if coalesce(o.is_late_entry, false) and coalesce(o.cash_amount_kobo, 0) > 0 then raise exception 'Cash was already taken for this paper sale, so it cannot be cancelled here. Confirm the transfer, or ask for help with a transfer that never arrived.'; end if;$n5$;
begin
  if exists (select 1 from public.paper_transfer_confirmations) then
    raise exception 'Transfer confirmations exist. They are audit records and are not dropped. Nothing was changed.';
  end if;
  if exists (select 1 from public.late_entries where shift_resolution = 'outside_shift_cash') then
    raise exception 'An entry was approved as outside_shift_cash. Nothing was changed.';
  end if;
  d := pg_get_functiondef('public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure);
  d := replace(replace(replace(replace(d, n4, o4), n3, o3), n2, o2), n1, o1);
  execute d;
  d := pg_get_functiondef('public.cancel_unpaid_order(uuid,text)'::regprocedure);
  execute replace(d, n5, o5);
end $undo$;
drop function if exists public.confirm_paper_transfer(uuid, text, text);
drop table if exists public.paper_transfer_confirmations;
alter table public.late_entries drop constraint if exists late_entries_shift_resolution_check;
alter table public.late_entries add constraint late_entries_shift_resolution_check
  check (shift_resolution is null or shift_resolution in ('open_shift_direct','closed_shift_included','closed_shift_late_cash'));
commit;
