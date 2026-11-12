-- =====================================================================
-- PremierJob — migration 007 : processus complet
--   1. Statuts d'offres : pending, published, rejected, paused, closed
--   2. Règle « aucune expérience exigée » appliquée par la base
--   3. Horaires du poste structurés : créneaux obligatoires / souhaités
--   4. Candidatures : nom, ville, transport, disponibilités, suivi
--      received → forwarded → interview → hired (+ rejected, withdrawn), historique
--   5. Limites anti-abus, suppression sur demande (Loi 25), journal des notifications
-- Écrite pour une base sans données réelles (12 nov. 2026), mais les valeurs
-- existantes sont converties, rien n'est supprimé. Peut être relancée.
-- =====================================================================

-- ---------- 0. Créneaux valides (7 jours × jour/soir/nuit) ----------
create or replace function public.pj_creneaux() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'lun-jour','lun-soir','lun-nuit','mar-jour','mar-soir','mar-nuit',
    'mer-jour','mer-soir','mer-nuit','jeu-jour','jeu-soir','jeu-nuit',
    'ven-jour','ven-soir','ven-nuit','sam-jour','sam-soir','sam-nuit',
    'dim-jour','dim-soir','dim-nuit']::text[];
$$;

-- ---------- 1. Détection d'une exigence d'expérience ----------
-- Renvoie le passage qui EXIGE de l'expérience (ex. « 2 ans d'expérience »), sinon null.
create or replace function public.pj_experience_exigee(t text) returns text
language plpgsql immutable set search_path = public as $$
declare s text := lower(coalesce(t, '')); m text[];
begin
  s := replace(s, '’', '''');
  -- « 2 ans d'expérience », « un an minimum d'expérience », « 6 mois d'expérience »
  m := regexp_match(s, '((\d+|un|une|deux|trois|quatre|cinq|six)\s*\+?\s*(an|ans|année|années|annee|annees|mois)\s+(minimum\s+|au moins\s+)?(d''|d\s+|de\s+)?\s*(exp[eé]rience|exp\M))');
  if m is not null then return m[1]; end if;
  -- « expérience de 2 ans », « expérience minimum 1 an »
  m := regexp_match(s, '(exp[eé]rience\s+(de\s+|d''|minimum\s+|minimale\s+de\s+|d''au moins\s+|d''un minimum de\s+)?(\d+|un|une|deux|trois|quatre|cinq|six)\s*(an|ans|année|années|annee|annees|mois)\M)');
  if m is not null then return m[1]; end if;
  -- « expérience obligatoire / exigée / essentielle / indispensable » (sauf « aucune expérience exigée »)
  m := regexp_match(s, '((?<!aucune )(?<!sans )(?<!pas d'')(?<!pas de )exp[eé]rience\s+((professionnelle|pr[eé]alable|pertinente|minimale|similaire|dans le domaine|en \w+)\s+)?(obligatoire|exig[eé]e|essentielle|indispensable))');
  if m is not null then return m[1]; end if;
  -- anglais : « 2 years of experience », « experience required »? (seulement la forme chiffrée)
  m := regexp_match(s, '(\d+\s*\+?\s*(years?|yrs?)\s+(of\s+)?(relevant\s+)?experience)');
  if m is not null then return m[1]; end if;
  return null;
end $$;

-- Mention d'expérience à faire vérifier par l'admin (sans bloquer).
create or replace function public.pj_experience_mentionnee(t text) returns boolean
language plpgsql immutable set search_path = public as $$
declare s text := lower(coalesce(t, ''));
begin
  s := replace(s, '’', '''');
  -- on retire les tournures qui disent clairement « pas d'expérience »
  s := regexp_replace(s, '(aucune|sans|pas d''|pas de)\s*(\w+\s+)?exp[eé]rience(\s+(professionnelle|pr[eé]alable|requise|exig[eé]e|n[eé]cessaire|obligatoire))*', ' ', 'g');
  s := regexp_replace(s, 'exp[eé]rience\s+(non|pas)\s+(requise|exig[eé]e|n[eé]cessaire|obligatoire)', ' ', 'g');
  s := regexp_replace(s, 'no experience( required| needed)?', ' ', 'g');
  return s ~ '(exp[eé]rience|experience)';
end $$;

-- ---------- 2. Offres ----------
alter table public.offres drop constraint if exists offres_statut_check;
update public.offres set statut = case statut
  when 'en_attente' then 'pending' when 'publiee' then 'published' when 'archivee' then 'closed' else statut end;
alter table public.offres alter column statut set default 'pending';
alter table public.offres add constraint offres_statut_check
  check (statut in ('pending','published','rejected','paused','closed'));

alter table public.offres
  add column if not exists lieu text check (char_length(lieu) <= 160),
  add column if not exists date_debut date,
  add column if not exists qualification text check (char_length(qualification) <= 160),
  add column if not exists nb_postes smallint not null default 1 check (nb_postes between 1 and 50),
  add column if not exists creneaux_obligatoires text[] not null default '{}',
  add column if not exists creneaux_souhaites text[] not null default '{}',
  add column if not exists reception text not null default 'courriel' check (reception in ('courriel','telephone')),
  add column if not exists aucune_experience_confirmee boolean not null default false,
  add column if not exists alerte_experience text,
  add column if not exists motif_refus text check (char_length(motif_refus) <= 500),
  add column if not exists statut_le timestamptz not null default now(),
  add column if not exists publiee_le timestamptz,
  add column if not exists fermee_le timestamptz;

alter table public.offres drop constraint if exists offres_creneaux_check;
alter table public.offres add constraint offres_creneaux_check check (
  creneaux_obligatoires <@ public.pj_creneaux() and creneaux_souhaites <@ public.pj_creneaux()
  and not (creneaux_obligatoires && creneaux_souhaites));

-- Contrôles de l'offre (s'exécutent pour tout le monde, y compris l'admin)
create or replace function public.pj_offre_controle() returns trigger
language plpgsql security definer set search_path = public as $$
declare texte text; exige text; tous text[]; admin boolean := public.is_admin();
begin
  texte := concat_ws(' ', new.titre, new.description, new.qualification);
  exige := public.pj_experience_exigee(texte);
  new.alerte_experience := case
    when exige is not null then 'Exigence d''expérience détectée : « ' || exige || ' »'
    when public.pj_experience_mentionnee(texte) then 'Le texte mentionne l''expérience : vérifier qu''elle n''est pas exigée'
    else null end;

  -- Horaires résumés (pour les filtres publics), déduits des créneaux
  tous := new.creneaux_obligatoires || new.creneaux_souhaites;
  if cardinality(tous) > 0 then
    new.horaires := array_remove(array[
      case when exists (select 1 from unnest(tous) c where c ~ '^(lun|mar|mer|jeu|ven)-jour$') then 'jour' end,
      case when exists (select 1 from unnest(tous) c where c ~ '^(lun|mar|mer|jeu|ven)-soir$') then 'soirs' end,
      case when exists (select 1 from unnest(tous) c where c ~ '-nuit$') then 'nuit' end,
      case when exists (select 1 from unnest(tous) c where c ~ '^(sam|dim)-') then 'fds' end
    ]::text[], null);
  end if;

  -- Soumission publique : règle sans expérience appliquée à l'entrée
  if tg_op = 'INSERT' and not admin then
    if not new.aucune_experience_confirmee then
      raise exception 'PJ_EXPERIENCE: confirmez qu''aucune expérience professionnelle préalable n''est exigée.';
    end if;
    if exige is not null then
      raise exception 'PJ_EXPERIENCE: le texte exige de l''expérience (« % »). PremierJob accepte seulement les postes sans expérience exigée.', exige;
    end if;
    if cardinality(tous) = 0 then
      raise exception 'PJ_HORAIRE: indiquez au moins un créneau de travail.';
    end if;
  end if;

  -- Publication : jamais sans validation humaine ni avec une exigence d'expérience
  if new.statut = 'published' then
    if exige is not null then
      raise exception 'PJ_PUBLICATION: impossible de publier, le texte exige de l''expérience (« % »).', exige;
    end if;
    if not new.aucune_experience_confirmee or not new.confirme then
      raise exception 'PJ_PUBLICATION: cochez les vérifications (aucune expérience exigée, confirmée avec l''employeur) avant de publier.';
    end if;
  end if;

  -- Dates de statut
  if tg_op = 'INSERT' or new.statut is distinct from old.statut then
    new.statut_le := now();
    if new.statut = 'published' then new.publiee_le := coalesce(new.publiee_le, now()); new.verifie_le := coalesce(new.verifie_le, current_date); end if;
    if new.statut = 'closed' then new.fermee_le := now(); end if;
  end if;
  return new;
end $$;

drop trigger if exists pj_offre_controle on public.offres;
create trigger pj_offre_controle before insert or update on public.offres
  for each row execute function public.pj_offre_controle();

-- Droits du public sur les offres
revoke all on public.offres from anon;
grant select (id, titre, employeur, ville, lieu, secteur, type, horaires, salaire, description, lien,
              confirme, statut, verifie_le, publiee_le, date_debut, qualification, nb_postes,
              creneaux_obligatoires, creneaux_souhaites)
  on public.offres to anon;
grant insert (titre, employeur, ville, lieu, secteur, type, horaires, salaire, description, lien,
              contact_nom, contact_courriel, contact_tel, date_debut, qualification, nb_postes,
              creneaux_obligatoires, creneaux_souhaites, reception, aucune_experience_confirmee)
  on public.offres to anon;

drop policy if exists "public lit les offres publiées" on public.offres;
create policy "public lit les offres publiées" on public.offres
  for select to anon, authenticated using (statut = 'published');

drop policy if exists "public soumet une offre" on public.offres;
create policy "public soumet une offre" on public.offres
  for insert to anon, authenticated
  with check (statut = 'pending' and source = 'employeur' and confirme = false
              and verifie_le is null and notes_admin is null and motif_refus is null
              and contact_courriel is not null and contact_nom is not null);

-- ---------- 3. Candidats (abonnés aux alertes) ----------
alter table public.candidats add column if not exists nom text check (char_length(nom) <= 80);
grant insert (nom) on public.candidats to anon;

-- ---------- 4. Candidatures ----------
alter table public.candidatures drop constraint if exists candidatures_statut_check;
update public.candidatures set statut = case statut
  when 'recue' then 'received' when 'envoyee' then 'forwarded' when 'entrevue' then 'interview'
  when 'embauche' then 'hired' when 'refusee' then 'rejected' else statut end;
alter table public.candidatures alter column statut set default 'received';
alter table public.candidatures add constraint candidatures_statut_check
  check (statut in ('received','forwarded','interview','hired','rejected','withdrawn'));

alter table public.candidatures
  add column if not exists nom text check (char_length(nom) <= 80),
  add column if not exists ville text check (char_length(ville) <= 40),
  add column if not exists transport text check (transport in ('auto','autobus','pied-velo')),
  add column if not exists dispos text[] not null default '{}',
  add column if not exists consentement_le timestamptz not null default now(),
  add column if not exists consentement_texte text check (char_length(consentement_texte) <= 400),
  add column if not exists statut_le timestamptz not null default now(),
  add column if not exists statut_par text not null default 'admin' check (statut_par in ('admin','employeur','candidat')),
  add column if not exists transmise_le timestamptz,
  add column if not exists entrevue_le timestamptz,
  add column if not exists embauche_le date,
  add column if not exists suivi14_fait boolean not null default false,
  add column if not exists suivi30_fait boolean not null default false;

alter table public.candidatures drop constraint if exists candidatures_dispos_check;
alter table public.candidatures add constraint candidatures_dispos_check check (dispos <@ public.pj_creneaux());

grant insert (id, nom, ville, transport, dispos, consentement_texte) on public.candidatures to anon;

-- Historique des changements de statut (journal)
create table if not exists public.candidature_historique (
  id             bigint generated always as identity primary key,
  candidature_id uuid not null references public.candidatures(id) on delete cascade,
  de             text,
  a              text not null,
  par            text not null,
  created_at     timestamptz not null default now()
);
alter table public.candidature_historique enable row level security;
revoke all on public.candidature_historique from anon, authenticated;
grant select on public.candidature_historique to authenticated;
drop policy if exists "admin lit l'historique" on public.candidature_historique;
create policy "admin lit l'historique" on public.candidature_historique
  for select to authenticated using (public.is_admin());

-- Transitions permises + dates + limites anti-abus
create or replace function public.pj_candidature_controle() returns trigger
language plpgsql security definer set search_path = public as $$
declare permis text[]; st text;
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
    new.statut_le := now();
    return new;
  end if;

  if new.statut is distinct from old.statut then
    permis := case old.statut
      when 'received'  then array['forwarded','rejected','withdrawn']
      when 'forwarded' then array['interview','hired','rejected','withdrawn','received']
      when 'interview' then array['hired','rejected','withdrawn','forwarded']
      when 'hired'     then array['interview','withdrawn']
      when 'rejected'  then array['received']
      when 'withdrawn' then array['received']
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
    if new.statut = 'interview' then new.entrevue_le := coalesce(new.entrevue_le, now()); end if;
    if new.statut = 'hired' then new.embauche_le := coalesce(new.embauche_le, current_date); end if;
    new.statut_le := now();
    insert into public.candidature_historique (candidature_id, de, a, par)
      values (new.id, old.statut, new.statut, new.statut_par);
  end if;
  return new;
end $$;

drop trigger if exists pj_candidature_controle on public.candidatures;
create trigger pj_candidature_controle before insert or update on public.candidatures
  for each row execute function public.pj_candidature_controle();

-- Postuler : seulement à une offre publiée, avec consentement, statut initial imposé
drop policy if exists "public postule a une offre publiee" on public.candidatures;
create policy "public postule a une offre publiee" on public.candidatures
  for insert to anon, authenticated
  with check (
    consentement = true and statut = 'received' and statut_par = 'admin' and notes_admin is null
    and transmise_le is null and embauche_le is null
    and exists (select 1 from public.offres o where o.id = offre_id and o.statut = 'published')
  );

-- Limite d'inscriptions aux alertes et de soumissions d'offres
create or replace function public.pj_limite_public() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'offres' then
    if (select count(*) from public.offres where created_at > now() - interval '1 hour'
        and source = 'employeur' and lower(contact_courriel) = lower(new.contact_courriel)) >= 5
       or (select count(*) from public.offres where created_at > now() - interval '1 hour' and source = 'employeur') >= 30 then
      raise exception 'PJ_LIMITE: trop d''offres envoyées en peu de temps. Réessayez plus tard ou écrivez-nous.';
    end if;
  elsif tg_table_name = 'candidats' then
    if (select count(*) from public.candidats where created_at > now() - interval '1 minute') >= 30 then
      raise exception 'PJ_LIMITE: beaucoup d''inscriptions en ce moment. Réessaie dans une minute.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pj_limite_offres on public.offres;
create trigger pj_limite_offres before insert on public.offres for each row execute function public.pj_limite_public();
drop trigger if exists pj_limite_candidats on public.candidats;
create trigger pj_limite_candidats before insert on public.candidats for each row execute function public.pj_limite_public();

-- ---------- 5. Suppression sur demande (Loi 25) ----------
create table if not exists public.journal_suppressions (
  id            bigint generated always as identity primary key,
  courriel_hash text not null,          -- empreinte, pas le courriel lui-même
  nb_inscriptions int not null,
  nb_candidatures int not null,
  created_at    timestamptz not null default now()
);
alter table public.journal_suppressions enable row level security;
revoke all on public.journal_suppressions from anon, authenticated;
grant select on public.journal_suppressions to authenticated;
drop policy if exists "admin lit le journal" on public.journal_suppressions;
create policy "admin lit le journal" on public.journal_suppressions for select to authenticated using (public.is_admin());

-- Supprime tout ce qui concerne un courriel; renvoie les CV à retirer du stockage.
create or replace function public.pj_supprimer_personne(p_courriel text)
returns table (cv_path text)
language plpgsql security definer set search_path = public, extensions as $$
declare n1 int; n2 int; chemins text[];
begin
  if not public.is_admin() then raise exception 'PJ_ADMIN: réservé à l''administrateur.'; end if;
  select array_agg(x.cv_path) into chemins from (
    select c.cv_path from public.candidats c where lower(c.courriel) = lower(p_courriel) and c.cv_path is not null
    union select a.cv_path from public.candidatures a where lower(a.courriel) = lower(p_courriel) and a.cv_path is not null) x;
  delete from public.candidats where lower(courriel) = lower(p_courriel); get diagnostics n1 = row_count;
  delete from public.candidatures where lower(courriel) = lower(p_courriel); get diagnostics n2 = row_count;
  insert into public.journal_suppressions (courriel_hash, nb_inscriptions, nb_candidatures)
    values (encode(extensions.digest(lower(p_courriel), 'sha256'), 'hex'), n1, n2);
  return query select unnest(coalesce(chemins, array[]::text[]));
end $$;
revoke all on function public.pj_supprimer_personne(text) from public, anon;
grant execute on function public.pj_supprimer_personne(text) to authenticated;

-- ---------- 6. Journal des notifications (rempli par la fonction « notifier ») ----------
create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  type         text not null,
  ref_id       uuid not null,
  destinataire text not null,
  statut       text not null default 'en_cours' check (statut in ('en_cours','envoye','echec','ignore')),
  erreur       text,
  created_at   timestamptz not null default now(),
  unique (type, ref_id, destinataire)
);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
drop policy if exists "admin lit les notifications" on public.notifications;
create policy "admin lit les notifications" on public.notifications for select to authenticated using (public.is_admin());

-- ---------- 7. Hygiène des droits ----------
revoke truncate, trigger, references on public.offres, public.candidats, public.candidatures, public.admins from authenticated;
revoke insert, update, delete on public.admins from authenticated;
