-- =====================================================================
-- PremierJob — migration 008 : déclenche la fonction « notifier » après
-- chaque offre soumise par un employeur et chaque candidature.
-- pg_net envoie l'appel en arrière-plan : un échec n'empêche JAMAIS l'enregistrement.
-- =====================================================================
create extension if not exists pg_net with schema extensions;

create or replace function public.pj_notifier() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    perform net.http_post(
      url := 'https://zgmyybminggblctvfiif.supabase.co/functions/v1/notifier',
      body := jsonb_build_object('type', case when tg_table_name = 'offres' then 'offre' else 'candidature' end, 'id', new.id),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 8000);
  exception when others then
    null; -- la notification est accessoire : on n'empêche pas la candidature
  end;
  return null;
end $$;
revoke all on function public.pj_notifier() from public, anon, authenticated;

drop trigger if exists pj_notifier_offre on public.offres;
create trigger pj_notifier_offre after insert on public.offres
  for each row when (new.source = 'employeur') execute function public.pj_notifier();

drop trigger if exists pj_notifier_candidature on public.candidatures;
create trigger pj_notifier_candidature after insert on public.candidatures
  for each row execute function public.pj_notifier();

-- ---------- 009 (appliquée le 12 nov. 2026) ----------
-- Les fonctions de déclencheur ne doivent pas être appelables directement par l'API.
revoke execute on function public.pj_offre_controle(), public.pj_candidature_controle(), public.pj_limite_public() from public, anon, authenticated;
