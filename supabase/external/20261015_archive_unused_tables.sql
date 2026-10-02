-- NairaPlate: mark two unused tables as archived. The data stays; only the names change. Nothing in the code or database refers to them.
-- app_state_snapshots (1 row, 25 September 2026) and saved_recipe_configs (4 rows, 23 and 24 September 2026).
-- Safe to re-run. Rollback: 20261015_archive_unused_tables_rollback.sql
do $$ begin
  if to_regclass('public.app_state_snapshots') is not null and to_regclass('public.archived_app_state_snapshots') is null then
    alter table public.app_state_snapshots rename to archived_app_state_snapshots;
  end if;
  if to_regclass('public.saved_recipe_configs') is not null and to_regclass('public.archived_saved_recipe_configs') is null then
    alter table public.saved_recipe_configs rename to archived_saved_recipe_configs;
  end if;
end $$;
