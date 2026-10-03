-- Rollback for the hygiene batch: puts every grant back exactly as the snapshot recorded it. Safe to re-run.
do $rb$ declare r record; f record; begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'grant_backup_20261025') then
    raise exception 'No snapshot found, so there is nothing to restore. Nothing was changed.';
  end if;
  for r in select grantee, table_name, privilege from public.grant_backup_20261025 loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = r.table_name) then
      execute format('grant %s on public.%I to %I', r.privilege, r.table_name, r.grantee);
    end if;
  end loop;
  for f in select function_signature from public.function_grant_backup_20261025 loop
    begin execute format('grant execute on function %s to public', f.function_signature); exception when undefined_function then null; end;
  end loop;
end $rb$;
