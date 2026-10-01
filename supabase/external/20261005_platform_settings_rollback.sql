-- Undo the platform settings. Saved prices and wording are lost, and every screen goes back to its built-in text.
drop function if exists public.public_settings();
drop table if exists public.platform_settings;
