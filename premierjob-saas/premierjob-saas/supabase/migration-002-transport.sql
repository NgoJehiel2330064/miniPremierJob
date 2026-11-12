-- =====================================================================
-- PremierJob — migration 002 : moyen de transport des candidats
-- À exécuter UNE fois dans Supabase > SQL Editor (peut être relancée sans risque).
-- Sans cette migration, le site fonctionne quand même : il enregistre
-- l'inscription sans le transport.
-- =====================================================================

alter table public.candidats
  add column if not exists transport text
  check (transport in ('auto','autobus','pied-velo'));

grant insert (transport) on public.candidats to anon;
