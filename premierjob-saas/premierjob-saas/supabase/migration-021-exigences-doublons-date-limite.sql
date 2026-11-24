-- Migration 021 : améliorations proposées par l'équipe (24 nov. 2026)
--   1. « Permis ou qualifications obligatoires » : 1000 caractères au lieu de 160 (listes et sauts de ligne permis).
--   2. Détection des offres en double : fonction pj_offres_semblables (avertit, ne bloque rien).
--   4. Date limite de candidature facultative : colonne offres.date_limite ; après cette date, l'offre
--      disparaît du site et une candidature directe est refusée.
-- Aucune donnée existante n'est modifiée.

-- 1. Exigences plus longues
alter table public.offres drop constraint offres_qualification_check;
alter table public.offres add constraint offres_qualification_check check (char_length(qualification) <= 1000);

-- 4. Date limite
alter table public.offres add column if not exists date_limite date;
grant select (date_limite), insert (date_limite) on public.offres to anon;
grant select (date_limite), insert (date_limite), update (date_limite) on public.offres to authenticated;

-- 2. Doublons : texte normalisé (minuscules, sans accents ni ponctuation)
create or replace function public.pj_norm(t text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(lower(translate(coalesce(t, ''),
    'àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- Part de mots communs (3 lettres et plus, sans « inc », « ltée »…) entre deux textes, de 0 à 1.
create or replace function public.pj_mots_communs(a text, b text) returns numeric
language sql immutable set search_path = public as $$
  with x as (select array(select distinct w from unnest(string_to_array(public.pj_norm(a), ' ')) w
                          where length(w) >= 3 and w not in ('inc','ltee','ltd','les','des','enr','cie')) m),
       y as (select array(select distinct w from unnest(string_to_array(public.pj_norm(b), ' ')) w
                          where length(w) >= 3 and w not in ('inc','ltee','ltd','les','des','enr','cie')) m)
  select case when cardinality(x.m) = 0 or cardinality(y.m) = 0 then 0 else
    (select count(*) from (select unnest(x.m) intersect select unnest(y.m)) i)::numeric
    / (select count(*) from (select unnest(x.m) union select unnest(y.m)) u) end
  from x, y
$$;

-- Offres actives (en attente, publiées, en pause) du même employeur, même ville, titre proche.
-- Titre proche : mêmes mots (3 lettres et plus) à au moins 50 %. Le public ne voit le détail que des offres publiées.
create or replace function public.pj_offres_semblables(p_employeur text, p_titre text, p_ville text, p_exclure uuid default null)
returns table (id uuid, titre text, employeur text, ville text, statut text)
language sql stable security definer set search_path = public as $$
  with p as (
    select public.pj_norm(p_employeur) e,
           array(select distinct w from unnest(string_to_array(public.pj_norm(p_titre), ' ')) w where length(w) >= 3) mots
  ), c as (
    select o.*, array(select distinct w from unnest(string_to_array(public.pj_norm(o.titre), ' ')) w where length(w) >= 3) mots
    from public.offres o, p
    where o.statut in ('pending', 'published', 'paused')
      and (p_exclure is null or o.id <> p_exclure)
      and o.ville = p_ville
      and length(p.e) >= 2
      and (public.pj_norm(o.employeur) = p.e
           or (length(p.e) >= 4 and position(p.e in public.pj_norm(o.employeur)) > 0)
           or (length(public.pj_norm(o.employeur)) >= 4 and position(public.pj_norm(o.employeur) in p.e) > 0)
           or public.pj_mots_communs(o.employeur, p_employeur) >= 0.5)
  )
  select c.id,
         case when public.is_admin() or c.statut = 'published' then c.titre end,
         case when public.is_admin() or c.statut = 'published' then c.employeur end,
         c.ville, c.statut
  from c, p
  where cardinality(p.mots) > 0
    and (select count(*) from (select unnest(c.mots) intersect select unnest(p.mots)) x)::numeric
        / greatest((select count(*) from (select unnest(c.mots) union select unnest(p.mots)) y), 1) >= 0.5
  order by (c.statut = 'published') desc, c.created_at desc
  limit 5
$$;
revoke all on function public.pj_offres_semblables(text, text, text, uuid) from public;
grant execute on function public.pj_offres_semblables(text, text, text, uuid) to anon, authenticated;

-- 4. Candidature refusée après la date limite (sauf admin), date du Québec
create or replace function public.pj_candidature_controle()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare permis text[]; st text; ext boolean; pub boolean; lim date;
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
      select date_limite into lim from public.offres where id = new.offre_id;
      if lim is not null and lim < (now() at time zone 'America/Toronto')::date then
        raise exception 'PJ_DATELIMITE: la date limite pour postuler à cette offre est passée.';
      end if;
    end if;
    select candidature_externe, offre_publique into ext, pub from public.offres where id = new.offre_id;
    if coalesce(pub, false) then
      new.canal := case when new.statut in ('intent','declared')
                          or coalesce(new.consentement_texte, '') like 'v2-declaree%' then 'externe' else 'interne' end;
    else
      new.canal := case when coalesce(ext, false) then 'externe' else 'interne' end;
    end if;
    if new.canal = 'externe' and new.statut = 'received' then new.statut := 'intent'; end if;
    if new.canal = 'interne' and new.statut in ('intent','declared') then new.statut := 'received'; end if;
    new.statut_le := now();
    return new;
  end if;

  new.canal := old.canal;

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
end $function$;
