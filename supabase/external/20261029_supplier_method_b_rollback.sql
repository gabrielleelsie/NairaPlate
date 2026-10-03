-- Rollback for part B: puts the three-argument function back (its payments are marked legacy).
create or replace function public.record_supplier_payment(p_supplier_id uuid, p_amount_kobo bigint, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  return public.record_supplier_payment_core(p_supplier_id, p_amount_kobo, p_note, 'legacy');
end $function$;
revoke all on function public.record_supplier_payment(uuid, bigint, text) from public, anon;
grant execute on function public.record_supplier_payment(uuid, bigint, text) to authenticated, service_role;
