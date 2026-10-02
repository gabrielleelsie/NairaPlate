-- Read-only. Expect: both archived tables exist with their rows, the old names are gone.
select
  to_regclass('public.archived_app_state_snapshots') is not null as snapshots_archived,
  to_regclass('public.archived_saved_recipe_configs') is not null as configs_archived,
  to_regclass('public.app_state_snapshots') is null as old_snapshots_name_gone,
  to_regclass('public.saved_recipe_configs') is null as old_configs_name_gone,
  (select count(*) from public.archived_app_state_snapshots) as snapshot_rows,
  (select count(*) from public.archived_saved_recipe_configs) as config_rows;
