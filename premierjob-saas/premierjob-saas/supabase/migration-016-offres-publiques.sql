-- =====================================================================
-- PremierJob — migration 016 : offres publiques
-- Une « offre publique » est une annonce déjà publiée par l'employeur sur
-- son propre site, reprise sur PremierJob avant tout accord de sa part.
-- - Seul un admin peut créer ou marquer une offre publique.
-- - Elle peut être publiée sans la case « confirmée avec l'employeur »,
--   mais jamais sans le lien de l'annonce sur le site de l'employeur,
--   et la règle « aucune expérience exigée » reste appliquée au texte.
-- - Elle n'a pas de date « vérifiée le » tant qu'elle reste publique.
-- - Le candidat choisit : postuler sur PremierJob (canal interne) ou sur le
--   site de l'employeur (canal externe, déclaré au retour). Pour ces offres
--   seulement, le canal vient du formulaire utilisé (consentement v2-declaree).
-- Aucune donnée existante n'est modifiée. Peut être relancée.
-- =====================================================================

alter table public.offres add column if not exists offre_publique boolean not null default false;
grant select (offre_publique) on public.offres to anon;

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

  -- Offre publique : réservée à l'admin
  if new.offre_publique and not admin then
    raise exception 'PJ_ACCES: seule l''équipe PremierJob peut ajouter une offre publique.';
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
    if new.offre_publique then
      if not new.aucune_experience_confirmee then
        raise exception 'PJ_PUBLICATION: cochez les vérifications (l''annonce n''exige aucune expérience) avant de publier.';
      end if;
      if new.lien is null then
        raise exception 'PJ_PUBLICATION: une offre publique doit avoir le lien de l''annonce sur le site de l''employeur.';
      end if;
    elsif not new.aucune_experience_confirmee or not new.confirme then
      raise exception 'PJ_PUBLICATION: cochez les vérifications (aucune expérience exigée, confirmée avec l''employeur) avant de publier.';
    end if;
  end if;

  -- Dates de statut (une offre publique n'est pas « vérifiée »)
  if tg_op = 'INSERT' or new.statut is distinct from old.statut then
    new.statut_le := now();
    if new.statut = 'published' then
      new.publiee_le := coalesce(new.publiee_le, now());
      if not new.offre_publique then new.verifie_le := coalesce(new.verifie_le, current_date); end if;
    end if;
    if new.statut = 'closed' then new.fermee_le := now(); end if;
  end if;
  if new.offre_publique then new.verifie_le := null; end if;
  -- Offre publique confirmée ensuite par l'employeur : elle devient vérifiée
  if tg_op = 'UPDATE' and old.offre_publique and not new.offre_publique and new.statut = 'published' then
    new.verifie_le := coalesce(new.verifie_le, current_date);
  end if;
  return new;
end $$;
revoke execute on function public.pj_offre_controle() from public, anon, authenticated;

create or replace function public.pj_candidature_controle() returns trigger
language plpgsql security definer set search_path = public as $$
declare permis text[]; st text; ext boolean; pub boolean;
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
    -- Le canal vient de l'offre ; pour une offre publique, du bouton choisi
    select candidature_externe, offre_publique into ext, pub from public.offres where id = new.offre_id;
    if coalesce(pub, false) then
      -- Le formulaire « j'ai postulé sur leur site » envoie le consentement v2-declaree
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
