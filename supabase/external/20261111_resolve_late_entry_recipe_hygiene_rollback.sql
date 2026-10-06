-- Undo 20261111_resolve_late_entry_recipe_hygiene.sql (puts back signed-in access; not recommended).
grant execute on function public.resolve_late_entry_recipe(text, text) to authenticated;
