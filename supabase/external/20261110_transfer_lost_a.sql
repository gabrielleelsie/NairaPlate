-- NairaPlate L1 (decided 6 October 2026): a split paper sale whose transfer never arrives can be closed as "transfer lost".
-- Run once in the Supabase SQL editor of the LIVE project, AFTER 20261107_paper_rules_a.sql. Safe to re-run.
-- Check afterwards: 20261110_transfer_lost_a_check.sql.  Undo: 20261110_transfer_lost_a_rollback.sql.
--
-- Rules:
--  * Only an owner / Supa Admin can do it, with a reason of 10 or more characters.
--  * Only on a paper sale that is awaiting payment, has cash taken (more than 0) and a transfer part that has not arrived (more than 0).
--    A transfer-only paper sale that never arrives is still cancelled as an unpaid order.
--  * The order moves to the new final status "transfer_lost". The cash stays counted in the drawer. The unpaid transfer amount is saved
--    as a loss in a new add-only table, with who, when and why, and an audit line is written. It cannot be undone, and the cash part
--    cannot be refunded through this route (a refund works only on paid orders).
--  * Stock is not given back: the food was served.
--  * NOT done here (decided to follow later): sales, profit and accountant reports. Until then reports that count only paid orders leave
--    these orders out. See the Master Specification, Part 9, L1.
-- Needs 20261107_paper_rules_a.sql (it also changes the message of the cancel rule, by exact-text replace; stops if the text is not found).

begin;

do $pre$
begin
  if to_regprocedure('public.cancel_unpaid_order(uuid,text)') is null or to_regprocedure('public.ledger_block_change()') is null
     or to_regprocedure('public.block_direct_insert()') is null or to_regclass('public.paper_transfer_confirmations') is null then
    raise exception 'Run 20261107_paper_rules_a.sql first. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_status_check_v2' and conrelid = 'public.orders'::regclass) then
    raise exception 'The order status rule orders_status_check_v2 was not found. Nothing was changed.';
  end if;
end $pre$;

-- 1. The new final status.
alter table public.orders drop constraint if exists orders_status_check_v2;
alter table public.orders add constraint orders_status_check_v2
  check (status in ('draft','paid','cancelled','refunded','partially_refunded','awaiting_payment','transfer_lost'));

-- 2. The loss record: add-only, one per order, written only by mark_paper_transfer_lost.
create table if not exists public.paper_transfer_losses (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  order_id uuid not null unique references public.orders(id),
  reason text not null check (length(btrim(reason)) >= 10),
  lost_kobo bigint not null check (lost_kobo > 0),
  cash_kept_kobo bigint not null check (cash_kept_kobo > 0),
  marked_by uuid,
  marked_by_name text,
  marked_at timestamptz not null default now()
);
alter table public.paper_transfer_losses enable row level security;
drop policy if exists paper_transfer_losses_select on public.paper_transfer_losses;
create policy paper_transfer_losses_select on public.paper_transfer_losses for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
         and ((auth.jwt() -> 'app_metadata') ->> 'role') in ('owner','supa_admin','cashier')
         and (select public.business_has_access(business_id)));
revoke all on public.paper_transfer_losses from public, anon, authenticated;
grant select on public.paper_transfer_losses to authenticated;
drop trigger if exists paper_transfer_losses_no_change on public.paper_transfer_losses;
create trigger paper_transfer_losses_no_change before update or delete on public.paper_transfer_losses
  for each row execute function public.ledger_block_change();
drop trigger if exists paper_transfer_losses_no_direct_insert on public.paper_transfer_losses;
create trigger paper_transfer_losses_no_direct_insert before insert on public.paper_transfer_losses
  for each row execute function public.block_direct_insert('A lost transfer is recorded only with the Mark transfer as lost button.');

-- 3. The only way to reach the new status.
create or replace function public.mark_paper_transfer_lost(p_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; o public.orders%rowtype; v_id uuid;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only a business owner can mark a transfer as lost.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Type a reason of at least 10 characters.'; end if;
  select * into o from public.orders where id = p_order_id and business_id = v_biz for update;
  if not found then raise exception 'Order not found.'; end if;
  if not coalesce(o.is_late_entry, false) then raise exception 'Only a paper sale can be handled here.'; end if;
  if o.status = 'transfer_lost' and exists (select 1 from public.paper_transfer_losses l where l.order_id = o.id) then
    return jsonb_build_object('order_id', o.id, 'status', 'transfer_lost', 'already_marked', true);
  end if;
  if o.status <> 'awaiting_payment' then raise exception 'This sale is % and is not waiting for a transfer.', o.status; end if;
  if coalesce(o.cash_amount_kobo, 0) <= 0 then
    raise exception 'No cash was taken on this sale. A transfer-only sale that never arrives is cancelled as an unpaid order instead.';
  end if;
  if coalesce(o.transfer_amount_kobo, 0) <= 0 then raise exception 'This sale has no transfer amount.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.paper_transfer_losses (business_id, order_id, reason, lost_kobo, cash_kept_kobo, marked_by, marked_by_name)
  values (v_biz, o.id, btrim(p_reason), o.transfer_amount_kobo, o.cash_amount_kobo, auth.uid(), coalesce(v_name, 'Owner')) returning id into v_id;
  perform set_config('app.payment_internal', '1', true);
  update public.orders set status = 'transfer_lost' where id = o.id;
  perform set_config('app.payment_internal', '', true);
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'paper_transfer_lost', 'orders', o.id,
          format('%s marked the transfer of %s kobo on paper sale %s as lost; the cash of %s kobo is kept. Reason: %s',
                 coalesce(v_name, 'Owner'), o.transfer_amount_kobo, coalesce(o.paper_reference, o.id::text), o.cash_amount_kobo, btrim(p_reason)));
  return jsonb_build_object('order_id', o.id, 'status', 'transfer_lost', 'loss_id', v_id, 'lost_kobo', o.transfer_amount_kobo, 'cash_kept_kobo', o.cash_amount_kobo, 'already_marked', false);
end $function$;
revoke all on function public.mark_paper_transfer_lost(uuid, text) from public, anon;
grant execute on function public.mark_paper_transfer_lost(uuid, text) to authenticated;

-- 4. The cancel rule now points to the new way out (exact-text replace; stops if the text is not found).
do $fix$
declare
  d text;
  o1 constant text := $o1$Confirm the transfer, or ask for help with a transfer that never arrived.$o1$;
  n1 constant text := $n1$Confirm the transfer, or mark the transfer as lost if it never arrives.$n1$;
begin
  d := pg_get_functiondef('public.cancel_unpaid_order(uuid,text)'::regprocedure);
  if position(n1 in d) > 0 then
    raise notice 'Cancel message already updated.';
  else
    if position(o1 in d) = 0 then raise exception 'cancel_unpaid_order is not the expected version. Nothing was changed.'; end if;
    execute replace(d, o1, n1);
  end if;
end $fix$;

commit;
