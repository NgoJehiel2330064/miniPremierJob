-- Migration 017 : une offre publique peut être publiée sans lien.
-- Cas : annonce repérée seulement sur un site concurrent (Indeed, Jobillico…). On ne met jamais de lien vers
-- ces sites : l'offre s'affiche alors avec le seul bouton « Postuler via PremierJob », et l'équipe contacte
-- l'employeur une fois les candidatures reçues. Le reste ne change pas : réservée à l'admin, case « aucune
-- expérience » obligatoire, texte qui exige de l'expérience refusé, lien concurrent toujours refusé (pj_offre_lien).
create or replace function public.pj_offre_controle()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare texte text; exige text; tous text[]; admin boolean := public.is_admin();
begin
  texte := concat_ws(' ', new.titre, new.description, new.qualification);
  exige := public.pj_experience_exigee(texte);
  new.alerte_experience := case
    when exige is not null then 'Exigence d''expérience détectée : « ' || exige || ' »'
    when public.pj_experience_mentionnee(texte) then 'Le texte mentionne l''expérience : vérifier qu''elle n''est pas exigée'
    else null end;

  tous := new.creneaux_obligatoires || new.creneaux_souhaites;
  if cardinality(tous) > 0 then
    new.horaires := array_remove(array[
      case when exists (select 1 from unnest(tous) c where c ~ '^(lun|mar|mer|jeu|ven)-jour$') then 'jour' end,
      case when exists (select 1 from unnest(tous) c where c ~ '^(lun|mar|mer|jeu|ven)-soir$') then 'soirs' end,
      case when exists (select 1 from unnest(tous) c where c ~ '-nuit$') then 'nuit' end,
      case when exists (select 1 from unnest(tous) c where c ~ '^(sam|dim)-') then 'fds' end
    ]::text[], null);
  end if;

  if new.offre_publique and not admin then
    raise exception 'PJ_ACCES: seule l''équipe PremierJob peut ajouter une offre publique.';
  end if;

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

  if new.statut = 'published' then
    if exige is not null then
      raise exception 'PJ_PUBLICATION: impossible de publier, le texte exige de l''expérience (« % »).', exige;
    end if;
    if new.offre_publique then
      if not new.aucune_experience_confirmee then
        raise exception 'PJ_PUBLICATION: cochez les vérifications (l''annonce n''exige aucune expérience) avant de publier.';
      end if;
    elsif not new.aucune_experience_confirmee or not new.confirme then
      raise exception 'PJ_PUBLICATION: cochez les vérifications (aucune expérience exigée, confirmée avec l''employeur) avant de publier.';
    end if;
  end if;

  if tg_op = 'INSERT' or new.statut is distinct from old.statut then
    new.statut_le := now();
    if new.statut = 'published' then
      new.publiee_le := coalesce(new.publiee_le, now());
      if not new.offre_publique then new.verifie_le := coalesce(new.verifie_le, current_date); end if;
    end if;
    if new.statut = 'closed' then new.fermee_le := now(); end if;
  end if;
  if new.offre_publique then new.verifie_le := null; end if;
  if tg_op = 'UPDATE' and old.offre_publique and not new.offre_publique and new.statut = 'published' then
    new.verifie_le := coalesce(new.verifie_le, current_date);
  end if;
  return new;
end $function$;
