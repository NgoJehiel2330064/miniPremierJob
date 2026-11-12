-- PremierJob — migration 004 : travail de nuit
-- Appliquée sur le projet PremierJob le 12 nov. 2026.
-- Ajoute « nuit » aux horaires des offres et aux disponibilités des candidats.
-- N'enlève aucune valeur existante : les données actuelles restent valides.
alter table public.offres drop constraint if exists offres_horaires_check;
alter table public.offres add constraint offres_horaires_check
  check (horaires <@ array['jour','soirs','nuit','fds','flexible']::text[]);

alter table public.candidats drop constraint if exists candidats_dispos_check;
alter table public.candidats add constraint candidats_dispos_check
  check (cardinality(dispos) >= 1 and dispos <@ array[
    'lun-jour','lun-soir','lun-nuit','mar-jour','mar-soir','mar-nuit',
    'mer-jour','mer-soir','mer-nuit','jeu-jour','jeu-soir','jeu-nuit',
    'ven-jour','ven-soir','ven-nuit','sam-jour','sam-soir','sam-nuit',
    'dim-jour','dim-soir','dim-nuit']::text[]);
