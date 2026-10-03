-- Rollback for A2: puts the open insert policy back (the audit trail can be forged again) and removes the triggers. Safe to re-run.
do $rb$ begin
  drop trigger if exists audit_logs_no_direct_insert on public.audit_logs;
  drop trigger if exists audit_logs_no_change on public.audit_logs;
  drop policy if exists audit_logs_insert on public.audit_logs;
  create policy audit_logs_insert on public.audit_logs for insert to authenticated
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser','cook','cashier'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  if not exists (select 1 from pg_trigger t where t.tgfoid = 'public.block_direct_insert()'::regprocedure and not t.tgisinternal) then
    drop function if exists public.block_direct_insert();
  end if;
end $rb$;
