-- =====================================================================
-- PremierJob — migration 015 : candidature déclarée sans téléphone
-- Offres sur le formulaire de l'employeur : le candidat postule directement
-- sur le site officiel, puis, s'il le veut, déclare sa candidature avec
-- son prénom et son courriel seulement. Le téléphone reste obligatoire
-- pour une candidature faite sur PremierJob (canal interne).
-- Aucune donnée existante n'est modifiée. Peut être relancée.
-- =====================================================================

alter table public.candidatures alter column telephone drop not null;

-- Le canal est fixé par le déclencheur pj_candidature_controle (BEFORE INSERT),
-- donc avant la vérification de cette contrainte.
alter table public.candidatures drop constraint if exists candidatures_tel_interne_check;
alter table public.candidatures add constraint candidatures_tel_interne_check
  check (canal = 'externe' or telephone is not null);
