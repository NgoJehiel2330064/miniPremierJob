-- =====================================================================
-- PremierJob — migration 005 : dépôt de CV
-- Appliquée sur le projet PremierJob le 12 nov. 2026.
-- Bucket PRIVÉ « cvs » : le public peut déposer un fichier (PDF ou Word, 5 Mo max)
-- mais ne peut ni le lire, ni le remplacer, ni le supprimer. Seul l'admin y a accès.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 5242880, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Nom de fichier imposé : un identifiant aléatoire + extension (aucun nom de personne).
drop policy if exists "public depose un CV" on storage.objects;
create policy "public depose un CV" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'cvs' and name ~ '^[0-9a-f-]{36}\.(pdf|doc|docx)$');

drop policy if exists "admin lit les CV" on storage.objects;
create policy "admin lit les CV" on storage.objects
  for select to authenticated
  using (bucket_id = 'cvs' and public.is_admin());

drop policy if exists "admin supprime les CV" on storage.objects;
create policy "admin supprime les CV" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cvs' and public.is_admin());

-- Lien entre le candidat et son fichier
alter table public.candidats
  add column if not exists cv_path text
  check (cv_path ~ '^[0-9a-f-]{36}\.(pdf|doc|docx)$');

grant insert (cv_path) on public.candidats to anon;
