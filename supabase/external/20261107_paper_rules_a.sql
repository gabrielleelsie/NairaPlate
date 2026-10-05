-- NairaPlate: paper (late) entry rules decided on 5 October 2026.
-- Run once in the Supabase SQL editor of the LIVE project, AFTER 20261106_late_entry_fixes_a.sql. Safe to re-run.
-- Check afterwards: 20261107_paper_rules_a_check.sql.  Undo: 20261107_paper_rules_a_rollback.sql.
--
-- Rules this script puts in the database:
--  D2. A paper sale paid by transfer OR split (cash + transfer) is posted as "awaiting payment", never as paid.
--      Only an owner / Supa Admin can confirm it, with proof (bank reference or note, 5+ characters) and a reason (5+ characters).
--      The confirmation is saved in a new add-only table and audited. Nobody can mark it paid any other way.
--  D3. A paper sale belongs to the shift it really happened in (already worked out when the entry is sent).
--      Still open  -> posted straight to that shift.
--      Now closed  -> the owner chooses closed_shift_included or closed_shift_late_cash, and must type a reason.
--      No shift at all -> the owner can only reject it, or approve it as outside_shift_cash with a reason.
--      The shift open at approval time is never used. (The cash counting itself is in src/lib/cash-drawer.ts, not in this script.)
--  Bug fixed on the way: with no choice made, a closed-shift entry slipped past the "explicit resolution" check (NULL is neither in nor not in a list).
--  Safety. A paper sale with cash already taken cannot be cancelled through the unpaid-order screen, because that would
--      silently remove cash from the drawer figure. How to handle a transfer that never arrives is an open decision.
-- Each existing function is read from the live database, the exact old text is replaced, and the function is saved again.
-- If the old text is not found, the script stops and changes nothing.
-- Needs 20261101_late_entries_a.sql and 20261105_late_entry_cost_at.sql.

begin;

-- 0. Pre-flight.
do $pre$
begin
  if to_regprocedure('public.approve_and_post_late_entry(uuid,text,text,text,text)') is null then
    raise exception 'Run 20261105_late_entry_cost_at.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.cancel_unpaid_order(uuid,text)') is null or to_regprocedure('public.ledger_block_change()') is null
     or to_regprocedure('public.block_direct_insert()') is null then
    raise exception 'A required function is missing. Nothing was changed.';
  end if;
end $pre$;

-- 1. A new way a paper sale can be resolved against a shift.
alter table public.late_entries drop constraint if exists late_entries_shift_resolution_check;
alter table public.late_entries add constraint late_entries_shift_resolution_check
  check (shift_resolution is null or shift_resolution in ('open_shift_direct','closed_shift_included','closed_shift_late_cash','outside_shift_cash'));

-- 2. Transfer confirmations: add-only, one per order, written only by confirm_paper_transfer.
create table if not exists public.paper_transfer_confirmations (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  order_id uuid not null unique references public.orders(id),
  proof_note text not null check (length(btrim(proof_note)) >= 5),
  reason text not null check (length(btrim(reason)) >= 5),
  confirmed_by uuid,
  confirmed_by_name text,
  transfer_kobo bigint not null check (transfer_kobo > 0),
  confirmed_at timestamptz not null default now()
);
alter table public.paper_transfer_confirmations enable row level security;
drop policy if exists paper_transfer_confirmations_select on public.paper_transfer_confirmations;
create policy paper_transfer_confirmations_select on public.paper_transfer_confirmations for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
         and ((auth.jwt() -> 'app_metadata') ->> 'role') in ('owner','supa_admin','cashier')
         and (select public.business_has_access(business_id)));
revoke all on public.paper_transfer_confirmations from public, anon, authenticated;
grant select on public.paper_transfer_confirmations to authenticated;
drop trigger if exists paper_transfer_confirmations_no_change on public.paper_transfer_confirmations;
create trigger paper_transfer_confirmations_no_change before update or delete on public.paper_transfer_confirmations
  for each row execute function public.ledger_block_change();
drop trigger if exists paper_transfer_confirmations_no_direct_insert on public.paper_transfer_confirmations;
create trigger paper_transfer_confirmations_no_direct_insert before insert on public.paper_transfer_confirmations
  for each row execute function public.block_direct_insert('A transfer is confirmed only with the Confirm transfer button.');

-- 3. The only way a paper transfer becomes paid.
create or replace function public.confirm_paper_transfer(p_order_id uuid, p_proof text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; o public.orders%rowtype; v_id uuid;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only a business owner can confirm a transfer.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_proof, ''))) < 5 then raise exception 'Type the bank reference or a short proof note (at least 5 characters).'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into o from public.orders where id = p_order_id and business_id = v_biz for update;
  if not found then raise exception 'Order not found.'; end if;
  if not coalesce(o.is_late_entry, false) then raise exception 'Only a paper sale can be confirmed here. Other transfers are confirmed by the bank.'; end if;
  if o.status = 'paid' and exists (select 1 from public.paper_transfer_confirmations c where c.order_id = o.id) then
    return jsonb_build_object('order_id', o.id, 'status', 'paid', 'already_confirmed', true);
  end if;
  if o.status <> 'awaiting_payment' then raise exception 'This sale is % and is not waiting for a transfer.', o.status; end if;
  if coalesce(o.transfer_amount_kobo, 0) <= 0 then raise exception 'This sale has no transfer amount to confirm.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.paper_transfer_confirmations (business_id, order_id, proof_note, reason, confirmed_by, confirmed_by_name, transfer_kobo)
  values (v_biz, o.id, btrim(p_proof), btrim(p_reason), auth.uid(), coalesce(v_name, 'Owner'), o.transfer_amount_kobo) returning id into v_id;
  perform set_config('app.payment_internal', '1', true);
  update public.orders set status = 'paid' where id = o.id;
  perform set_config('app.payment_internal', '', true);
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'paper_transfer_confirmed', 'orders', o.id,
          format('%s confirmed the transfer of %s kobo on paper sale %s. Proof: %s. Reason: %s',
                 coalesce(v_name, 'Owner'), o.transfer_amount_kobo, coalesce(o.paper_reference, o.id::text), btrim(p_proof), btrim(p_reason)));
  return jsonb_build_object('order_id', o.id, 'status', 'paid', 'confirmation_id', v_id, 'already_confirmed', false);
end $function$;
revoke all on function public.confirm_paper_transfer(uuid, text, text) from public, anon;
grant execute on function public.confirm_paper_transfer(uuid, text, text) to authenticated;

-- 4. Patch the approval function and the unpaid-order cancel function (exact-text replace; stops if the text is not found).
do $fix$
declare
  d text; n text;
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
  d := pg_get_functiondef('public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure);
  if position(n2 in d) > 0 then
    raise notice 'Approval rules already applied.';
  else
    if position(o1 in d) = 0 or position(o2 in d) = 0 or position(o3 in d) = 0 or position(o4 in d) = 0 then
      raise exception 'approve_and_post_late_entry is not the expected version. Nothing was changed.';
    end if;
    n := replace(replace(replace(replace(d, o1, n1), o2, n2), o3, n3), o4, n4);
    execute n;
  end if;
  d := pg_get_functiondef('public.cancel_unpaid_order(uuid,text)'::regprocedure);
  if position(n5 in d) > 0 then
    raise notice 'Cancel rule already applied.';
  else
    if position(o5 in d) = 0 then raise exception 'cancel_unpaid_order is not the expected version. Nothing was changed.'; end if;
    execute replace(d, o5, n5);
  end if;
end $fix$;

commit;
