-- A task's Discussion is shared by every member, and it updates live
-- (WC-172, "Task discussions need a refresh to show new comments: make them
-- live").
--
-- Dane, 2026-11-12, asked which rule to build, chose A: "every member reads
-- every comment and may post on any task. Members still edit and remove only
-- their own comments." Until now a member read only their own comments and
-- posted only on their own tasks (20261028130000_task_comments.sql), so two
-- members could never talk in one Discussion.
--
-- 1. Every signed-in member reads every comment, and may comment on any
--    task, in their own name only. Editing and removing stay the writer's
--    own (those two policies are unchanged).
-- 2. A comment's files are readable by whoever can read the comment, which is
--    now every member, so the stored copies in a comments folder are too.
--    Attaching a file still needs the member's own comment on their own task
--    (unchanged, "task_files: owner can insert").
-- 3. task_comments joins the `supabase_realtime` publication: the list of
--    tables whose changes Supabase Realtime pushes to listening browsers.
--    Realtime checks row-level security for every listener, so a browser
--    hears only about comments its signed-in member may read; a signed-out
--    visitor (the `anon` role, which holds no grant on the table) hears
--    nothing. A delete sends only the comment's id (the table keeps the
--    default replica identity), never its words.
--
-- Plain-words explanation: docs/DATA_MODEL.md. No row changes. Safe to
-- re-run: every statement checks before it creates or replaces.

-- 1. Reading and posting -------------------------------------------------

drop policy if exists "task_comments: owner can read"   on public.task_comments;
drop policy if exists "task_comments: members can read" on public.task_comments;
create policy "task_comments: members can read" on public.task_comments
  for select to authenticated
  using (true);

-- Any task that exists, in the member's own name only.
drop policy if exists "task_comments: owner can insert"  on public.task_comments;
drop policy if exists "task_comments: member can insert" on public.task_comments;
create policy "task_comments: member can insert" on public.task_comments
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.tasks t where t.id = task_id)
  );

-- 2. A comment's stored files --------------------------------------------

-- The rows already follow the comment ("task_files: members can read" asks
-- whether the comment can be seen), so only the stored copies change: every
-- file in the bucket is now readable by every member, as a task's own files
-- already were. Adding and deleting stay inside the member's own folder.
drop policy if exists "task-files: members can read" on storage.objects;
create policy "task-files: members can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'task-files');

-- 3. Live updates --------------------------------------------------------

do $$
begin
  -- Supabase makes this publication itself; make it on a database that lacks it.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
  ) then
    alter publication supabase_realtime add table public.task_comments;
  end if;
end;
$$;

notify pgrst, 'reload schema';
