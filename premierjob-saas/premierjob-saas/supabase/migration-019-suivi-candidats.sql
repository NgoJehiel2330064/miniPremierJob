-- Migration 019 : suivi automatique des candidats (fonction « suivi »), chaque heure à :20.
-- La fonction n'envoie qu'entre 8 h et 20 h (heure du Québec) et chaque courriel une seule fois.
-- À appliquer seulement après accord de Jehiel (envoie de vrais courriels aux candidats).
select cron.schedule('pj-suivi-candidats', '20 * * * *', $$
  select net.http_post(url := 'https://hejkousthfnfckblwkqw.supabase.co/functions/v1/suivi',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$$);
