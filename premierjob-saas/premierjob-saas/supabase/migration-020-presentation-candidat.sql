-- Migration 020 : le champ « message » des candidatures devient la présentation du candidat
-- (profil, compétences, expériences, motivations), surtout utile pour ceux qui n'ont pas de CV.
-- Limite portée de 500 à 1500 caractères. Aucune donnée modifiée : la contrainte est seulement élargie.
alter table public.candidatures drop constraint candidatures_message_check;
alter table public.candidatures add constraint candidatures_message_check check (char_length(message) <= 1500);
