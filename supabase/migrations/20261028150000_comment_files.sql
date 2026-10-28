-- Files attached to a Discussion comment (Dane, 2026-10-27: "allow links and
-- attachments"). They reuse the `task-files` bucket and the `task_files`
-- table: a file row now says, optionally, which comment it belongs to. A file
-- with no comment is the task's own, as before. core/files.ts keeps the
-- stored copies and the rows in step. Plain-words explanation:
-- docs/DATA_MODEL.md.
--
-- A comment's files are as private as the comment: today a comment is seen
-- only by the member who wrote it, so its files are too, while a task's own
-- files stay readable by every member.
--
-- Additive only: no existing row changes. Safe to re-run: every statement
-- checks before it creates or replaces.

-- A comment's files are stored under `<owner id>/<task id>/comments/`, so the
-- bucket's rules can tell them apart from the task's own files.

-- 1. The link from a file to its comment --------------------------------

-- The pair (id, task_id) is unique because id is: this lets a file point at
-- a comment AND its task in one link, so a file can never sit on one task
-- while its comment sits on another.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_comments_id_task_key') then
    alter table public.task_comments add constraint task_comments_id_task_key unique (id, task_id);
  end if;
end;
$$;

alter table public.task_files add column if not exists comment_id uuid;

do $$
begin
  -- Removing a comment removes its file rows with it (core deletes the
  -- stored copies first; see removeCommentWithFiles).
  if not exists (select 1 from pg_constraint where conname = 'task_files_comment_fk') then
    alter table public.task_files
      add constraint task_files_comment_fk
      foreign key (comment_id, task_id) references public.task_comments (id, task_id) on delete cascade;
  end if;
  -- A comment's file sits in the comments folder, and only a comment's file does.
  if not exists (select 1 from pg_constraint where conname = 'task_files_comment_folder') then
    alter table public.task_files
      add constraint task_files_comment_folder
      check ((comment_id is not null) = starts_with(path, owner_id::text || '/' || task_id::text || '/comments/'));
  end if;
end;
$$;

create index if not exists task_files_comment_id_idx on public.task_files (comment_id) where comment_id is not null;

-- 2. Who may read and attach ---------------------------------------------

-- A task's own file: every member. A comment's file: whoever can see the
-- comment (row-level security on task_comments decides, inside this check).
drop policy if exists "task_files: members can read" on public.task_files;
create policy "task_files: members can read" on public.task_files
  for select to authenticated
  using (comment_id is null or exists (select 1 from public.task_comments c where c.id = comment_id));

-- A member may only attach to a task of their own, and to a comment only if
-- it is their own comment on that same task.
drop policy if exists "task_files: owner can insert" on public.task_files;
create policy "task_files: owner can insert" on public.task_files
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = (select auth.uid()))
    and (
      comment_id is null
      or exists (
        select 1 from public.task_comments c
        where c.id = comment_id and c.task_id = task_files.task_id and c.owner_id = (select auth.uid())
      )
    )
  );

-- The stored copies: a task's own file is readable by every member; a file
-- in a comments folder only by the member whose folder it is. Adding and
-- deleting stay inside the member's own folder, as before.
drop policy if exists "task-files: members can read" on storage.objects;
create policy "task-files: members can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-files'
    and (
      (storage.foldername(name))[3] is distinct from 'comments'
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

notify pgrst, 'reload schema';
