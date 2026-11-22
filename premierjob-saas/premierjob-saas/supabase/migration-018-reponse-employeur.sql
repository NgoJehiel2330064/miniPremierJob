-- Migration 018 : réponse de l'employeur en un clic.
-- Chaque candidature transmise reçoit un jeton secret (un seul par candidature). Le courriel à l'employeur
-- contient trois liens premierjob.ca/reponse?j=<jeton>&r=appele|embauche|pas_retenu. La page demande une
-- confirmation (les antivirus de courriel ouvrent les liens tout seuls), puis la fonction « reponse »
-- enregistre le choix et met le statut à jour (Entrevue, Embauché, Non retenue).
-- Additif seulement : aucune colonne ni règle existante n'est modifiée.
create table if not exists public.reponses_employeur (
  jeton uuid primary key default gen_random_uuid(),
  candidature_id uuid not null unique references public.candidatures(id) on delete cascade,
  created_at timestamptz not null default now(),
  reponse text check (reponse in ('appele','embauche','pas_retenu')),
  repondu_le timestamptz,
  nb_reponses int not null default 0
);
alter table public.reponses_employeur enable row level security;
-- Seul l'admin lit et crée les jetons (depuis le tableau de bord). Le public n'a aucun accès :
-- la fonction « reponse » passe par la clé de service.
drop policy if exists "admin gere les jetons de reponse" on public.reponses_employeur;
create policy "admin gere les jetons de reponse" on public.reponses_employeur
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.reponses_employeur from anon;
grant select, insert on public.reponses_employeur to authenticated;
