-- Removes the supplier payment functions, guards and extra columns, all or nothing.
-- Refuses (and changes nothing) if any reversal exists, because it would lose the correction.
do $$ begin
  if exists (select 1 from public.supplier_transactions where type = 'reversal') then
    raise exception 'Reversals exist. Rolling back would lose them. Nothing was changed.';
  end if;
  drop function if exists public.reverse_supplier_payment(uuid, text);
  drop function if exists public.record_supplier_payment(uuid, bigint, text);
  drop function if exists public.supplier_balance_kobo(text, uuid);
  drop trigger if exists supplier_transactions_check_reversal on public.supplier_transactions;
  drop trigger if exists supplier_transactions_no_change on public.supplier_transactions;
  drop function if exists public.supplier_transactions_check_reversal();
  drop index if exists public.supplier_transactions_one_reversal;
  alter table public.supplier_transactions drop constraint if exists supplier_transactions_reason_rule;
  alter table public.supplier_transactions drop constraint if exists supplier_transactions_reversal_rule;
  alter table public.supplier_transactions drop constraint if exists supplier_transactions_amount_positive;
  alter table public.supplier_transactions drop constraint if exists supplier_transactions_type_check;
  alter table public.supplier_transactions add constraint supplier_transactions_type_check check (type in ('purchase_on_credit','payment'));
  alter table public.supplier_transactions drop column if exists recorded_by_name, drop column if exists reason, drop column if exists reverses_id;
end $$;
