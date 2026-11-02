-- Score "Edited a comment" (Dane, 2026-11-01, on the sweep ticket: "B ...
-- 1 point per task is fine for now"; listed by
-- 20261102120000_scoring_actions_sweep.sql, wired here). Each saved change to
-- a comment's words is one engagement, credited to the member who wrote the
-- comment, naming the tool that made the edit and the comment's task. A save
-- that leaves the words as they were is not scored.
--
-- core/comments.ts editComment is the only path that edits a comment; this
-- trigger records it inside the same save, so a failed engagement fails the
-- edit and the screen says so. Kept in step with SCORING_TRIGGERS in
-- core/game.ts (a test checks this function exists).
--
-- No new table. Safe to re-run.

create or replace function public.task_comments_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    perform public.record_engagement(new.owner_id, 'edited_a_comment', new.tool, new.task_id);
  end if;
  return null;
end;
$$;

drop trigger if exists task_comments_score on public.task_comments;
create trigger task_comments_score
  after update of body on public.task_comments
  for each row execute function public.task_comments_score();

revoke execute on function public.task_comments_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
