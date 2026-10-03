-- Rollback: puts batches back on the shared function (which is the broken state: batch logging fails again). Only use if this fix causes a problem.
drop trigger if exists batches_stamp_version on public.batches;
create trigger batches_stamp_version before insert on public.batches
  for each row execute function public.stamp_recipe_version();
drop function if exists public.stamp_batch_version();
