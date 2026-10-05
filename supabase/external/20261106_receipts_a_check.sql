-- Read-only. Expected one row: true, false, true, 0, 0, 4, 3, 3
select
  (select count(*) = 1 from storage.buckets where id = 'receipts')                          as bucket_exists,
  (select public from storage.buckets where id = 'receipts')                                 as bucket_public,
  (select relrowsecurity from pg_class where oid = 'public.receipts'::regclass)              as rls_on,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'receipts' and grantee = 'anon')         as anon_table_grants,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'receipts' and grantee = 'authenticated') as auth_table_grants,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('attach_receipt','void_receipt','list_receipts','receipt_counts')
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute'))                             as rpcs_signed_in_only,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'receipts_obj_%')                                                   as storage_policies,
  (select count(*) from pg_trigger where tgrelid = 'public.receipts'::regclass and not tgisinternal) + 2 as guard_marker;
