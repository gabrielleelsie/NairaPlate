-- Rollback for Step 7 part A. REFUSES (changes nothing) if any reversal row exists, because that would lose real records.
-- Otherwise it removes the three functions, the rules, indexes and new columns, and puts the batch stock-mode trigger function back as it was.
-- All or nothing.
do $rb$ begin
  if exists (select 1 from public.channel_payouts where kind = 'reversal')
     or exists (select 1 from public.price_decisions where kind = 'reversal')
     or exists (select 1 from public.batches where kind = 'reversal') then
    raise exception 'Reversal entries exist. Rolling back would lose them. Nothing was changed.';
  end if;
  drop function if exists public.reverse_payout(uuid, text);
  drop function if exists public.reverse_price_decision(uuid, text);
  drop function if exists public.reverse_batch(uuid, text);
  create or replace function public.check_batch_stock_mode()
  returns trigger language plpgsql set search_path to 'public' as $function$
  begin
    if exists (select 1 from public.recipes where id = NEW.recipe_id and stock_mode = 'made_to_order') then
      raise exception 'This dish is set to Made to order, so its stock goes down when it is sold. Change it to Cooked in batches if you want to log batches.';
    end if;
    perform set_config('app.stock_reason', 'batch_use', true);
    perform set_config('app.stock_ref', NEW.id::text, true);
    return NEW;
  end $function$;
  drop index if exists public.channel_payouts_one_reversal;
  drop index if exists public.price_decisions_one_reversal;
  drop index if exists public.batches_one_reversal;
  alter table public.channel_payouts drop constraint if exists channel_payouts_kind_rule;
  alter table public.price_decisions drop constraint if exists price_decisions_kind_rule;
  alter table public.batches drop constraint if exists batches_kind_rule;
  alter table public.price_decisions drop constraint if exists price_decisions_decision_check;
  alter table public.price_decisions add constraint price_decisions_decision_check
    check (decision = any (array['publish'::text, 'adjust_portion'::text, 'defer'::text]));
  alter table public.channel_payouts drop column if exists recorded_by_name, drop column if exists reason, drop column if exists reverses_id, drop column if exists kind;
  alter table public.price_decisions drop column if exists recorded_by_name, drop column if exists reason, drop column if exists reverses_id, drop column if exists kind;
  alter table public.batches drop column if exists recorded_by_name, drop column if exists reason, drop column if exists reverses_id, drop column if exists kind;
end $rb$;
