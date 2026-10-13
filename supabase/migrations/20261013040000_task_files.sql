-- Files attached to tasks (Dane, 2026-10-12: "files/images" on a task, first
-- for the WaveCenter logo and favicon). The stored copies live in a private
-- Supabase Storage bucket, never on the web host's disk (engineering rule 5);
-- `task_files` says which task each one belongs to. core/files.ts keeps the
-- two in step. Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

-- The bucket: private (every read needs a short-lived signed link), and no
-- file over 10 MB, the same limit core/files.ts checks before upload.
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- Each member's files sit under a folder named with their own id:
-- <owner_id>/<task_id>/<random id>-<file name>. A member may read, add and
-- delete only inside their own folder. No update rule: a stored file is
-- never overwritten, only removed and attached again.
drop policy if exists "task-files: owner can read"   on storage.objects;
drop policy if exists "task-files: owner can add"    on storage.objects;
drop policy if exists "task-files: owner can delete" on storage.objects;

create policy "task-files: owner can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'task-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "task-files: owner can add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "task-files: owner can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- One row per attached file.
create table if not exists public.task_files (
  id           uuid        primary key default gen_random_uuid(),
  task_id      uuid        not null references public.tasks (id) on delete cascade,
  owner_id     uuid        not null default auth.uid()
                           references auth.users (id) on delete cascade,
  path         text        not null unique,
  name         text        not null check (length(btrim(name)) > 0),
  content_type text,
  size_bytes   bigint      not null check (size_bytes between 0 and 10485760),
  tool         text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at   timestamptz not null default now(),
  -- The row must point into its own owner's folder for its own task.
  constraint task_files_path_in_task_folder
    check (starts_with(path, owner_id::text || '/' || task_id::text || '/'))
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. As with tasks, start from no rights at all (Supabase's defaults
-- include TRUNCATE) and grant only what is used. No update: a file row is
-- written once and removed, never changed.
alter table public.task_files enable row level security;

create index if not exists task_files_task_id_idx  on public.task_files (task_id);
create index if not exists task_files_owner_id_idx on public.task_files (owner_id);

revoke all on public.task_files from anon, authenticated;
grant select, insert, delete on public.task_files to authenticated;

drop policy if exists "task_files: owner can read"   on public.task_files;
drop policy if exists "task_files: owner can insert" on public.task_files;
drop policy if exists "task_files: owner can delete" on public.task_files;

create policy "task_files: owner can read" on public.task_files
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- A member may only attach to a task of their own.
create policy "task_files: owner can insert" on public.task_files
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = (select auth.uid()))
  );

create policy "task_files: owner can delete" on public.task_files
  for delete to authenticated
  using ((select auth.uid()) = owner_id);
