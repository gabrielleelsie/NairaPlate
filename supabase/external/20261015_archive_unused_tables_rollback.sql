do $$ begin
  if to_regclass('public.archived_app_state_snapshots') is not null and to_regclass('public.app_state_snapshots') is null then
    alter table public.archived_app_state_snapshots rename to app_state_snapshots;
  end if;
  if to_regclass('public.archived_saved_recipe_configs') is not null and to_regclass('public.saved_recipe_configs') is null then
    alter table public.archived_saved_recipe_configs rename to saved_recipe_configs;
  end if;
end $$;
