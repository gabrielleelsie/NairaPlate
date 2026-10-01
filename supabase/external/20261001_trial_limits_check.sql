-- Read-only: confirms the trial limit rules are installed. Expect 3 triggers and 4 functions.
select (select count(*) from pg_trigger where tgname in ('recipes_trial_limit','recipe_items_trial_limit','ingredients_trial_limit') and not tgisinternal) as triggers,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('trial_limits_apply','enforce_trial_recipe_limit','enforce_trial_recipe_items_limit','enforce_trial_ingredient_limit')) as functions;
