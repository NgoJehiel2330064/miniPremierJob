-- =====================================================================
-- PremierJob — migration 006 : candidatures à une offre précise
-- Appliquée sur le projet PremierJob le 12 nov. 2026.
-- Le public peut postuler (insertion seulement) à une offre PUBLIÉE.
-- Postuler = accord pour que la candidature et le CV soient transmis à CET employeur.
-- Seul l'admin lit, suit (statut) et supprime les candidatures.
-- =====================================================================

create table if not exists public.candidatures (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  offre_id      uuid not null references public.offres(id) on delete cascade,
  prenom        text not null check (char_length(prenom) between 1 and 60),
  courriel      text not null check (char_length(courriel) <= 160
                                     and courriel ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  telephone     text not null check (char_length(telephone) between 7 and 30),
  cv_path       text check (cv_path ~ '^[0-9a-f-]{36}\.(pdf|doc|docx)$'),
  message       text check (char_length(message) <= 500),
  consentement  boolean not null check (consentement = true),
  statut        text not null default 'recue'
                check (statut in ('recue','envoyee','entrevue','embauche','refusee')),
  notes_admin   text check (char_length(notes_admin) <= 2000)
);

create unique index if not exists candidatures_une_par_offre
  on public.candidatures (offre_id, lower(courriel));
create index if not exists candidatures_recentes on public.candidatures (created_at desc);

alter table public.candidatures enable row level security;

revoke all on public.candidatures from anon;
grant insert (offre_id, prenom, courriel, telephone, cv_path, message, consentement)
  on public.candidatures to anon;
grant select, insert, update, delete on public.candidatures to authenticated;

drop policy if exists "public postule a une offre publiee" on public.candidatures;
create policy "public postule a une offre publiee" on public.candidatures
  for insert to anon, authenticated
  with check (
    consentement = true and statut = 'recue' and notes_admin is null
    and exists (select 1 from public.offres o where o.id = offre_id and o.statut = 'publiee')
  );

drop policy if exists "admin gere les candidatures" on public.candidatures;
create policy "admin gere les candidatures" on public.candidatures
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
