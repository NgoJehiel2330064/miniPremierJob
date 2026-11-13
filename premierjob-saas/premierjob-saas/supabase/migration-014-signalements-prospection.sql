-- =====================================================================
-- PremierJob — migration 014
-- 1. Signalements : un visiteur peut signaler une offre (pourvue, info fausse,
--    lien brisé, arnaque, autre). Il ne peut rien lire ; l'admin traite.
-- 2. Prospection : pour les offres repérées sur le site d'un employeur et
--    enregistrées sans publier, on suit l'appel (à appeler, à rappeler,
--    confirmée, plus disponible, refus) et la date d'accord de l'employeur.
-- Aucune donnée existante n'est modifiée. Peut être relancée.
-- =====================================================================

-- ---------- 1. Signalements ----------
create table if not exists public.signalements (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  offre_id    uuid not null references public.offres(id) on delete cascade,
  raison      text not null check (raison in ('pourvue','info_incorrecte','lien_brise','arnaque','autre')),
  commentaire text check (char_length(commentaire) <= 500),
  courriel    text check (char_length(courriel) <= 160),
  traite      boolean not null default false,
  traite_le   timestamptz
);
create index if not exists signalements_ouverts on public.signalements (traite, created_at desc);

alter table public.signalements enable row level security;
revoke all on public.signalements from anon, authenticated;
grant insert (offre_id, raison, commentaire, courriel) on public.signalements to anon, authenticated;
grant select, update, delete on public.signalements to authenticated;
grant usage on sequence public.signalements_id_seq to anon, authenticated;

drop policy if exists "public signale une offre publiee" on public.signalements;
create policy "public signale une offre publiee" on public.signalements
  for insert to anon, authenticated
  with check (traite = false and traite_le is null
              and exists (select 1 from public.offres o where o.id = offre_id and o.statut = 'published'));

drop policy if exists "admin gere les signalements" on public.signalements;
create policy "admin gere les signalements" on public.signalements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.pj_signalement_controle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() and (select count(*) from public.signalements where created_at > now() - interval '1 minute') >= 20 then
      raise exception 'PJ_LIMITE: beaucoup de signalements en ce moment. Réessaie dans une minute.';
    end if;
    return new;
  end if;
  if new.traite and not old.traite then new.traite_le := now(); end if;
  if not new.traite then new.traite_le := null; end if;
  return new;
end $$;
revoke execute on function public.pj_signalement_controle() from public, anon, authenticated;
drop trigger if exists pj_signalement_controle on public.signalements;
create trigger pj_signalement_controle before insert or update on public.signalements
  for each row execute function public.pj_signalement_controle();

-- ---------- 2. Prospection des offres repérées ----------
alter table public.offres
  add column if not exists prospection text check (prospection in ('a_appeler','rappeler','confirmee','plus_disponible','refus')),
  add column if not exists prospection_le timestamptz,
  add column if not exists accord_employeur_le timestamptz;

create or replace function public.pj_offre_prospection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.prospection is distinct from old.prospection then
    new.prospection_le := case when new.prospection is null then null else now() end;
    if new.prospection = 'confirmee' then new.accord_employeur_le := coalesce(new.accord_employeur_le, now()); end if;
  end if;
  return new;
end $$;
revoke execute on function public.pj_offre_prospection() from public, anon, authenticated;
drop trigger if exists pj_offre_prospection on public.offres;
create trigger pj_offre_prospection before insert or update on public.offres
  for each row execute function public.pj_offre_prospection();
