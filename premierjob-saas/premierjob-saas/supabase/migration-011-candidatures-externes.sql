-- =====================================================================
-- PremierJob — migration 011 : candidatures sur le site de l'employeur
-- Pour les employeurs qui gardent leur propre formulaire (ex. Subway) :
--   1. L'offre indique « candidature sur le site de l'employeur » (lien obligatoire).
--   2. Le candidat s'identifie sur PremierJob (intention), part vers le formulaire
--      officiel, puis déclare l'avoir envoyé (déclarée).
--   3. PremierJob signale les noms au gérant (transmise / signalée).
--   4. Le candidat peut déclarer la suite (appelé, embauché, sans nouvelles).
--   5. L'admin confirme avec l'employeur (confirmée par l'employeur, embauche).
-- Ne prouve jamais seul qu'une candidature a été reçue : « déclarée » reste « déclarée ».
-- Aucune donnée existante n'est modifiée. Peut être relancée.
-- =====================================================================

-- ---------- 1. Offres ----------
alter table public.offres
  add column if not exists candidature_externe boolean not null default false;

alter table public.offres drop constraint if exists offres_externe_lien_check;
alter table public.offres add constraint offres_externe_lien_check
  check (not candidature_externe or lien is not null);

grant select (candidature_externe) on public.offres to anon;

-- Jamais de redirection vers une plateforme d'emploi concurrente
create or replace function public.pj_lien_concurrent(u text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(u, '') ~* '^https?://([a-z0-9-]+\.)*(indeed|jobillico|jobboom|glassdoor|monster|workopolis|ziprecruiter|linkedin|talent|simplyhired|neuvoo|jooble|careerbeacon|eluta)\.[a-z.]+(/|\?|#|$)';
$$;

create or replace function public.pj_offre_lien() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lien is not null and new.lien !~* '^https?://' then
    raise exception 'PJ_LIEN: le lien doit commencer par https://';
  end if;
  if public.pj_lien_concurrent(new.lien) then
    raise exception 'PJ_LIEN: PremierJob ne renvoie jamais vers une autre plateforme d''emploi. Utilisez le lien du site ou du formulaire de l''employeur.';
  end if;
  return new;
end $$;
revoke execute on function public.pj_offre_lien() from public, anon, authenticated;
drop trigger if exists pj_offre_lien on public.offres;
create trigger pj_offre_lien before insert or update of lien on public.offres
  for each row execute function public.pj_offre_lien();

-- ---------- 2. Candidatures ----------
alter table public.candidatures
  add column if not exists canal text not null default 'interne' check (canal in ('interne','externe')),
  add column if not exists declaree_le timestamptz,
  add column if not exists resultat_declare text check (resultat_declare in ('pas_encore','sans_nouvelles','appele','embauche')),
  add column if not exists resultat_declare_le timestamptz,
  add column if not exists confirmee_employeur boolean not null default false,
  add column if not exists confirmee_employeur_le timestamptz;

alter table public.candidatures drop constraint if exists candidatures_statut_check;
alter table public.candidatures add constraint candidatures_statut_check
  check (statut in ('received','intent','declared','forwarded','interview','hired','rejected','withdrawn'));

-- « reçue » n'existe que pour une candidature faite sur PremierJob;
-- « intention » et « déclarée » seulement pour le formulaire de l'employeur.
alter table public.candidatures drop constraint if exists candidatures_canal_statut_check;
alter table public.candidatures add constraint candidatures_canal_statut_check check (
  (canal = 'interne' and statut not in ('intent','declared')) or (canal = 'externe' and statut <> 'received'));

-- Contrôles : canal déduit de l'offre, transitions, dates, limites anti-abus
create or replace function public.pj_candidature_controle() returns trigger
language plpgsql security definer set search_path = public as $$
declare permis text[]; st text; ext boolean;
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      if (select count(*) from public.candidatures
          where lower(courriel) = lower(new.courriel) and created_at > now() - interval '10 minutes') >= 5 then
        raise exception 'PJ_LIMITE: trop de candidatures en peu de temps. Réessaie dans quelques minutes.';
      end if;
      if (select count(*) from public.candidatures where created_at > now() - interval '1 minute') >= 30 then
        raise exception 'PJ_LIMITE: le site reçoit beaucoup de candidatures. Réessaie dans une minute.';
      end if;
    end if;
    -- Le canal vient de l'offre, jamais du formulaire
    select candidature_externe into ext from public.offres where id = new.offre_id;
    new.canal := case when coalesce(ext, false) then 'externe' else 'interne' end;
    if new.canal = 'externe' and new.statut = 'received' then new.statut := 'intent'; end if;
    if new.canal = 'interne' and new.statut in ('intent','declared') then new.statut := 'received'; end if;
    new.statut_le := now();
    return new;
  end if;

  new.canal := old.canal; -- le canal ne change jamais

  if new.confirmee_employeur and not old.confirmee_employeur then new.confirmee_employeur_le := now(); end if;
  if not new.confirmee_employeur then new.confirmee_employeur_le := null; end if;
  if new.resultat_declare is distinct from old.resultat_declare then new.resultat_declare_le := now(); end if;

  if new.statut is distinct from old.statut then
    permis := case old.statut
      when 'received'  then array['forwarded','rejected','withdrawn']
      when 'intent'    then array['declared','forwarded','interview','hired','rejected','withdrawn']
      when 'declared'  then array['forwarded','interview','hired','rejected','withdrawn','intent']
      when 'forwarded' then array['interview','hired','rejected','withdrawn','received','intent','declared']
      when 'interview' then array['hired','rejected','withdrawn','forwarded']
      when 'hired'     then array['interview','withdrawn']
      when 'rejected'  then array['received','intent','declared']
      when 'withdrawn' then array['received','intent','declared']
      else array[]::text[] end;
    if not (new.statut = any(permis)) then
      raise exception 'PJ_TRANSITION: passage de « % » à « % » non permis.', old.statut, new.statut;
    end if;
    if new.statut = 'forwarded' then
      select statut into st from public.offres where id = new.offre_id;
      if st not in ('published','paused') then
        raise exception 'PJ_TRANSITION: l''offre n''est pas active, la candidature ne peut pas être transmise.';
      end if;
      new.transmise_le := coalesce(old.transmise_le, now());
    end if;
    if new.statut = 'declared' then new.declaree_le := coalesce(old.declaree_le, now()); end if;
    if new.statut = 'interview' then new.entrevue_le := coalesce(new.entrevue_le, now()); end if;
    if new.statut = 'hired' then new.embauche_le := coalesce(new.embauche_le, current_date); end if;
    new.statut_le := now();
    insert into public.candidature_historique (candidature_id, de, a, par)
      values (new.id, old.statut, new.statut, new.statut_par);
  end if;
  return new;
end $$;
revoke execute on function public.pj_candidature_controle() from public, anon, authenticated;

-- Postuler : offre publiée, consentement, aucun champ de suivi rempli d'avance
drop policy if exists "public postule a une offre publiee" on public.candidatures;
create policy "public postule a une offre publiee" on public.candidatures
  for insert to anon, authenticated
  with check (
    consentement = true and statut in ('received','intent') and statut_par = 'admin' and notes_admin is null
    and transmise_le is null and embauche_le is null and declaree_le is null
    and resultat_declare is null and confirmee_employeur = false
    and exists (select 1 from public.offres o where o.id = offre_id and o.statut = 'published')
  );

-- ---------- 3. Réponses du candidat (sans compte, sans droit de lecture) ----------
-- Clé : la référence de candidature (identifiant aléatoire gardé sur son téléphone) + son courriel.
-- Ne renvoie que le nouveau statut, jamais de données.
create or replace function public.pj_candidat_repondre(p_id uuid, p_courriel text, p_reponse text)
returns text
language plpgsql security definer set search_path = public as $$
declare c public.candidatures%rowtype;
begin
  if p_reponse not in ('envoyee','pas_encore','sans_nouvelles','appele','embauche','retirer') then
    raise exception 'PJ_REPONSE: réponse inconnue.';
  end if;
  select * into c from public.candidatures
   where id = p_id and lower(courriel) = lower(trim(coalesce(p_courriel, '')))
     and created_at > now() - interval '180 days';
  if not found then raise exception 'PJ_INTROUVABLE: candidature introuvable.'; end if;

  if p_reponse = 'retirer' then
    if c.statut not in ('withdrawn','hired') then
      update public.candidatures set statut = 'withdrawn', statut_par = 'candidat' where id = c.id;
      return 'withdrawn';
    end if;
    return c.statut;
  end if;

  -- « C'est envoyé » (ou un appel, une embauche : la candidature a forcément été envoyée)
  if p_reponse in ('envoyee','appele','embauche') and c.statut = 'intent' then
    update public.candidatures set statut = 'declared', statut_par = 'candidat' where id = c.id;
    c.statut := 'declared';
  end if;
  if p_reponse <> 'envoyee' then
    update public.candidatures set resultat_declare = p_reponse where id = c.id;
  end if;
  return c.statut;
end $$;
revoke all on function public.pj_candidat_repondre(uuid, text, text) from public;
grant execute on function public.pj_candidat_repondre(uuid, text, text) to anon, authenticated;
