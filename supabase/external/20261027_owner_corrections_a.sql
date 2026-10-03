-- NairaPlate Step 7, part A: owner-only corrections for channel payouts, price decisions and batches.
-- Run once in the Supabase SQL editor, BEFORE the new screens are released. Safe to re-run. Rollback: 20261027_owner_corrections_a_rollback.sql
-- These three tables are frozen (Step 6). A mistake is corrected the same way as purchases and debts: the original stays, an owner adds a
-- REVERSAL entry (reason of 5+ characters required), each entry can be reversed once, and a reversal is final.
--   Payout:   the reversal cancels the payout. The owner then records the correct one on the normal screen.
--   Decision: reversing a "publish" decision puts the dish's price back to what it was, but only if the price is still the one that decision
--             set and no later published decision is still standing. Other decisions (adjust portion, defer) changed no price, so only the record is reversed.
--   Batch:    the reversal puts back the full ingredient stock the batch used (even if some has been used since). Batches logged before the
--             stock trail carried their batch id cannot be reversed (the six existing batches are in this group, like old purchases).
-- Reversed entries and their reversal rows carry negated figures, so any total that sums them nets to zero. Screens hide reversed pairs from totals.
-- Needs ledger_block_change(), block_direct_insert(), price_decisions_protect() (Step 6). Nothing changes for existing rows or old screens until an owner reverses something.

-- 1. Columns, one reversal per entry, and a rule that ties kind, link and reason together.
alter table public.channel_payouts
  add column if not exists kind text not null default 'entry',
  add column if not exists reverses_id uuid references public.channel_payouts(id) on delete restrict,
  add column if not exists reason text,
  add column if not exists recorded_by_name text;
alter table public.price_decisions
  add column if not exists kind text not null default 'entry',
  add column if not exists reverses_id uuid references public.price_decisions(id) on delete restrict,
  add column if not exists reason text,
  add column if not exists recorded_by_name text;
alter table public.batches
  add column if not exists kind text not null default 'entry',
  add column if not exists reverses_id uuid references public.batches(id) on delete restrict,
  add column if not exists reason text,
  add column if not exists recorded_by_name text;

alter table public.channel_payouts drop constraint if exists channel_payouts_kind_rule;
alter table public.channel_payouts add constraint channel_payouts_kind_rule check (
  (kind = 'entry' and reverses_id is null and reason is null)
  or (kind = 'reversal' and reverses_id is not null and length(btrim(coalesce(reason, ''))) >= 5));
alter table public.price_decisions drop constraint if exists price_decisions_kind_rule;
alter table public.price_decisions add constraint price_decisions_kind_rule check (
  (kind = 'entry' and reverses_id is null and reason is null)
  or (kind = 'reversal' and reverses_id is not null and length(btrim(coalesce(reason, ''))) >= 5));
alter table public.batches drop constraint if exists batches_kind_rule;
alter table public.batches add constraint batches_kind_rule check (
  (kind = 'entry' and reverses_id is null and reason is null)
  or (kind = 'reversal' and reverses_id is not null and length(btrim(coalesce(reason, ''))) >= 5));

create unique index if not exists channel_payouts_one_reversal on public.channel_payouts (reverses_id) where reverses_id is not null;
create unique index if not exists price_decisions_one_reversal on public.price_decisions (reverses_id) where reverses_id is not null;
create unique index if not exists batches_one_reversal on public.batches (reverses_id) where reverses_id is not null;

-- A reversal row of a decision has its own decision value.
alter table public.price_decisions drop constraint if exists price_decisions_decision_check;
alter table public.price_decisions add constraint price_decisions_decision_check
  check (decision = any (array['publish'::text, 'adjust_portion'::text, 'defer'::text, 'reversal'::text]));

-- 2. A batch reversal row must not be refused for a made-to-order dish, and must not label stock as "batch use".
create or replace function public.check_batch_stock_mode()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if NEW.kind = 'reversal' then return NEW; end if;
  if exists (select 1 from public.recipes where id = NEW.recipe_id and stock_mode = 'made_to_order') then
    raise exception 'This dish is set to Made to order, so its stock goes down when it is sold. Change it to Cooked in batches if you want to log batches.';
  end if;
  perform set_config('app.stock_reason', 'batch_use', true);
  perform set_config('app.stock_ref', NEW.id::text, true);
  return NEW;
end $function$;

-- 3. Reverse a channel payout.
create or replace function public.reverse_payout(p_payout_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; p public.channel_payouts%rowtype; v_id uuid;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse a payout.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into p from public.channel_payouts where id = p_payout_id and business_id = v_biz for update;
  if not found then raise exception 'Payout not found.'; end if;
  if p.kind <> 'entry' then raise exception 'Only a payout can be reversed.'; end if;
  if exists (select 1 from public.channel_payouts where reverses_id = p.id) then raise exception 'This payout has already been reversed.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();

  insert into public.channel_payouts (business_id, channel, gross_sales_kobo, commission_kobo, net_payout_kobo, period_start, period_end,
                                      kind, reverses_id, reason, recorded_by_name)
  values (v_biz, p.channel, -p.gross_sales_kobo, -p.commission_kobo, -p.net_payout_kobo, p.period_start, p.period_end,
          'reversal', p.id, btrim(p_reason), coalesce(v_name, 'Owner'))
  returning id into v_id;

  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'payout_reversed', 'channel_payouts', v_id,
          format('%s reversed a %s payout of %s: %s', coalesce(v_name, 'Owner'), p.channel, public.audit_naira(p.net_payout_kobo), btrim(p_reason)));
  return jsonb_build_object('reversal_id', v_id);
end $function$;

-- 4. Reverse a price decision.
create or replace function public.reverse_price_decision(p_decision_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; d public.price_decisions%rowtype; r public.recipes%rowtype; v_id uuid; v_restored boolean := false; v_dish text;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse a price decision.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into d from public.price_decisions where id = p_decision_id and business_id = v_biz for update;
  if not found then raise exception 'Decision not found.'; end if;
  if d.kind <> 'entry' then raise exception 'Only a decision can be reversed.'; end if;
  if exists (select 1 from public.price_decisions where reverses_id = d.id) then raise exception 'This decision has already been reversed.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();

  if d.decision = 'publish' then
    if d.recipe_id is null then raise exception 'The dish for this decision no longer exists, so its price cannot be restored.'; end if;
    if d.previous_price_kobo is null then raise exception 'No earlier price was recorded for this decision, so it cannot be reversed.'; end if;
    select * into r from public.recipes where id = d.recipe_id and business_id = v_biz for update;
    if not found then raise exception 'Dish not found.'; end if;
    if r.selling_price_kobo is distinct from d.suggested_price_kobo then
      raise exception 'Cannot be reversed because the dish price has changed since this decision.';
    end if;
    if exists (select 1 from public.price_decisions x
                where x.recipe_id = d.recipe_id and x.business_id = v_biz and x.kind = 'entry' and x.decision = 'publish'
                  and (x.created_at, x.id) > (d.created_at, d.id)
                  and not exists (select 1 from public.price_decisions z where z.reverses_id = x.id)) then
      raise exception 'Cannot be reversed because a newer published price exists for this dish.';
    end if;
    update public.recipes set selling_price_kobo = d.previous_price_kobo where id = d.recipe_id;
    v_restored := true;
    v_dish := r.name;
  else
    select name into v_dish from public.recipes where id = d.recipe_id;
  end if;

  insert into public.price_decisions (business_id, recipe_id, previous_price_kobo, suggested_price_kobo, decision, decided_by,
                                      kind, reverses_id, reason, recorded_by_name)
  values (v_biz, d.recipe_id,
          case when v_restored then d.suggested_price_kobo else d.previous_price_kobo end,
          case when v_restored then d.previous_price_kobo else d.suggested_price_kobo end,
          'reversal', auth.uid(), 'reversal', d.id, btrim(p_reason), coalesce(v_name, 'Owner'))
  returning id into v_id;

  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'price_decision_reversed', 'price_decisions', v_id,
          format('%s reversed a price decision for %s (%s)%s: %s', coalesce(v_name, 'Owner'), coalesce(v_dish, 'a dish'), d.decision,
                 case when v_restored then ', price back to ' || public.audit_naira(d.previous_price_kobo) else ', no price change' end, btrim(p_reason)));
  return jsonb_build_object('reversal_id', v_id, 'price_restored', v_restored, 'price_kobo', case when v_restored then d.previous_price_kobo else null end);
end $function$;

-- 5. Reverse a batch (puts the stock back).
create or replace function public.reverse_batch(p_batch_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; b public.batches%rowtype; v_id uuid; m record; v_dish text; v_n int := 0;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse a batch.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into b from public.batches where id = p_batch_id and business_id = v_biz for update;
  if not found then raise exception 'Batch not found.'; end if;
  if b.kind <> 'entry' then raise exception 'Only a batch can be reversed.'; end if;
  if exists (select 1 from public.batches where reverses_id = b.id) then raise exception 'This batch has already been reversed.'; end if;
  if not exists (select 1 from public.stock_movements where ref_id = b.id and reason = 'batch_use' and business_id = v_biz) then
    raise exception 'This batch was recorded before reversals existed, so its stock cannot be put back and it cannot be reversed.';
  end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  select name into v_dish from public.recipes where id = b.recipe_id;

  insert into public.batches (business_id, recipe_id, scale_factor, actual_yield, ingredient_cost_kobo, packaging_kobo, utilities_kobo, logged_by,
                              kind, reverses_id, reason, recorded_by_name)
  values (v_biz, b.recipe_id, -b.scale_factor, -b.actual_yield, -b.ingredient_cost_kobo, -b.packaging_kobo, -b.utilities_kobo, auth.uid(),
          'reversal', b.id, btrim(p_reason), coalesce(v_name, 'Owner'))
  returning id into v_id;

  perform set_config('app.stock_reason', 'batch_reversed', true);
  perform set_config('app.stock_ref', b.id::text, true);
  for m in select ingredient_id, sum(qty_base) as used from public.stock_movements
            where ref_id = b.id and reason = 'batch_use' and business_id = v_biz group by ingredient_id loop
    update public.ingredients set stock_base_qty = stock_base_qty - m.used where id = m.ingredient_id and business_id = v_biz;
    v_n := v_n + 1;
  end loop;
  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_ref', '', true);

  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'batch_reversed', 'batches', v_id,
          format('%s reversed a batch of %s (%s plates); stock put back for %s ingredient(s): %s', coalesce(v_name, 'Owner'), coalesce(v_dish, 'a dish'),
                 b.actual_yield, v_n, btrim(p_reason)));
  return jsonb_build_object('reversal_id', v_id, 'ingredients_restored', v_n);
end $function$;

-- 6. Only signed-in people can call them (each checks role, business and plan inside).
revoke all on function public.reverse_payout(uuid, text) from public, anon;
revoke all on function public.reverse_price_decision(uuid, text) from public, anon;
revoke all on function public.reverse_batch(uuid, text) from public, anon;
grant execute on function public.reverse_payout(uuid, text) to authenticated;
grant execute on function public.reverse_price_decision(uuid, text) to authenticated;
grant execute on function public.reverse_batch(uuid, text) to authenticated;
