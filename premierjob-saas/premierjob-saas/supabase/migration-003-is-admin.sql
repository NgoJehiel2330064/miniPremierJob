-- PremierJob — migration 003 : le public (anon) n'a pas besoin d'appeler is_admin().
-- Appliquée sur le projet PremierJob le 12 nov. 2026.
revoke execute on function public.is_admin() from anon;
