-- PremierJob — migration 012 : un employeur peut laisser seulement son téléphone
-- (porte-à-porte : beaucoup de gérants préfèrent être appelés). Il faut au moins un des deux.
drop policy if exists "public soumet une offre" on public.offres;
create policy "public soumet une offre" on public.offres
  for insert to anon, authenticated
  with check (statut = 'pending' and source = 'employeur' and confirme = false
              and verifie_le is null and notes_admin is null and motif_refus is null
              and contact_nom is not null
              and (contact_courriel is not null or contact_tel is not null));
