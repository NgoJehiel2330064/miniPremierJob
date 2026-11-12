-- =====================================================================
-- PremierJob Saguenay — schéma Supabase
-- À coller dans Supabase > SQL Editor > New query, puis « Run ».
-- Le script peut être relancé sans risque (idempotent).
-- =====================================================================

-- ---------- Tables ----------

create table if not exists public.admins (
  email text primary key
);

create table if not exists public.offres (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  titre            text not null check (char_length(titre) between 3 and 120),
  employeur        text not null check (char_length(employeur) between 2 and 120),
  ville            text not null check (ville in ('Jonquière','Chicoutimi','La Baie','Autre')),
  secteur          text check (char_length(secteur) <= 80),
  type             text not null check (type in ('Temps partiel','Temps plein','Stage','Été')),
  horaires         text[] not null default '{}'
                   check (horaires <@ array['jour','soirs','fds','flexible']::text[]),
  salaire          text check (char_length(salaire) <= 40),
  description      text check (char_length(description) <= 1500),
  lien             text check (char_length(lien) <= 500),
  -- Coordonnées privées de l'employeur (jamais visibles du public)
  contact_nom      text check (char_length(contact_nom) <= 120),
  contact_courriel text check (char_length(contact_courriel) <= 160),
  contact_tel      text check (char_length(contact_tel) <= 30),
  -- Champs gérés par l'admin
  confirme         boolean not null default false,
  statut           text not null default 'en_attente'
                   check (statut in ('en_attente','publiee','archivee')),
  verifie_le       date,
  source           text not null default 'employeur' check (source in ('employeur','admin')),
  notes_admin      text check (char_length(notes_admin) <= 2000)
);

-- (transport ajouté par la migration 002 pour les bases déjà créées)
create table if not exists public.candidats (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  prenom         text not null check (char_length(prenom) between 1 and 60),
  courriel       text not null check (char_length(courriel) <= 160
                                      and courriel ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  telephone      text check (char_length(telephone) <= 30),
  etablissement  text check (char_length(etablissement) <= 80),
  domaine        text check (char_length(domaine) <= 120),
  ville          text check (char_length(ville) <= 40),
  transport      text check (transport in ('auto','autobus','pied-velo')),
  types          text[] not null default '{}'
                 check (types <@ array['Temps partiel','Temps plein','Stage','Été']::text[]),
  dispos         text[] not null
                 check (cardinality(dispos) >= 1 and dispos <@ array[
                   'lun-jour','lun-soir','mar-jour','mar-soir','mer-jour','mer-soir',
                   'jeu-jour','jeu-soir','ven-jour','ven-soir','sam-jour','sam-soir',
                   'dim-jour','dim-soir']::text[]),
  consentement   boolean not null check (consentement = true),
  consenti_le    timestamptz not null default now(),
  actif          boolean not null default true,
  notes_admin    text check (char_length(notes_admin) <= 2000)
);

create unique index if not exists candidats_courriel_unique on public.candidats (lower(courriel));
create index if not exists offres_statut_idx on public.offres (statut, verifie_le desc);

-- ---------- Fonction admin ----------
-- Un admin = un utilisateur connecté dont le courriel est dans la table admins.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;  -- pas au public (anon)

-- ---------- Sécurité (RLS) ----------

alter table public.admins    enable row level security;
alter table public.offres    enable row level security;
alter table public.candidats enable row level security;

-- Droits de colonnes pour le public (anon) : il ne voit jamais les coordonnées privées.
revoke all on public.offres    from anon;
revoke all on public.candidats from anon;
revoke all on public.admins    from anon;

grant select (id, titre, employeur, ville, secteur, type, horaires, salaire,
              description, lien, confirme, statut, verifie_le)
  on public.offres to anon;
grant insert (titre, employeur, ville, secteur, type, horaires, salaire,
              description, lien, contact_nom, contact_courriel, contact_tel)
  on public.offres to anon;
grant insert (prenom, courriel, telephone, etablissement, domaine, ville,
              transport, types, dispos, consentement)
  on public.candidats to anon;

grant select, insert, update, delete on public.offres, public.candidats to authenticated;
grant select on public.admins to authenticated;

-- Politiques : on les recrée proprement à chaque exécution.
drop policy if exists "public lit les offres publiées" on public.offres;
drop policy if exists "public soumet une offre"       on public.offres;
drop policy if exists "admin gère les offres"         on public.offres;
drop policy if exists "public s'inscrit"              on public.candidats;
drop policy if exists "admin gère les candidats"      on public.candidats;
drop policy if exists "admin se voit"                 on public.admins;

create policy "public lit les offres publiées" on public.offres
  for select to anon, authenticated
  using (statut = 'publiee');

create policy "public soumet une offre" on public.offres
  for insert to anon, authenticated
  with check (statut = 'en_attente' and source = 'employeur' and confirme = false
              and verifie_le is null and notes_admin is null);

create policy "admin gère les offres" on public.offres
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "public s'inscrit" on public.candidats
  for insert to anon, authenticated
  with check (consentement = true and actif = true and notes_admin is null);

create policy "admin gère les candidats" on public.candidats
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin se voit" on public.admins
  for select to authenticated
  using (public.is_admin());

-- ---------- À FAIRE UNE FOIS : ton courriel d'admin ----------
-- Remplace l'adresse ci-dessous par celle de ton compte admin, puis exécute.
insert into public.admins (email) values ('ngoumdjeuj@gmail.com')
  on conflict (email) do nothing;
