-- PremierJob — migration 013
-- 1. Toutes les villes et secteurs du Saguenay et des environs (même liste que common.js).
-- 2. Une offre soumise par un employeur doit préciser le lieu, le salaire et les tâches.
create or replace function public.pj_villes() returns text[]
language sql immutable set search_path = public as $$
  select array['Chicoutimi','Jonquière','La Baie','Laterrière','Shipshaw','Canton-Tremblay','Lac-Kénogami',
    'Saint-Honoré','Saint-Fulgence','Saint-Ambroise','Saint-David-de-Falardeau','Larouche','Bégin',
    'Saint-Charles-de-Bourget','Sainte-Rose-du-Nord','Saint-Félix-d''Otis','Rivière-Éternité',
    'L''Anse-Saint-Jean','Petit-Saguenay','Ferland-et-Boilleau','Alma','Autre']::text[];
$$;

alter table public.offres drop constraint if exists offres_ville_check;
alter table public.offres add constraint offres_ville_check check (ville = any (public.pj_villes()));

drop policy if exists "public soumet une offre" on public.offres;
create policy "public soumet une offre" on public.offres
  for insert to anon, authenticated
  with check (statut = 'pending' and source = 'employeur' and confirme = false
              and verifie_le is null and notes_admin is null and motif_refus is null
              and contact_nom is not null
              and (contact_courriel is not null or contact_tel is not null)
              and char_length(coalesce(lieu, '')) >= 3
              and char_length(coalesce(salaire, '')) >= 1
              and char_length(coalesce(description, '')) >= 15);
