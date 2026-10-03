-- Read-only. Expect: batch_trigger_function stamp_batch_version, order_trigger_function stamp_recipe_version.
select
  (select p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.batches'::regclass and t.tgname = 'batches_stamp_version') as batch_trigger_function,
  (select p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.order_items'::regclass and t.tgname = 'order_items_stamp_version') as order_trigger_function;
