-- Wire "Deleted a comment" (deleted_a_comment, listed by
-- 20261102120000_scoring_actions_sweep.sql) so it earns its points: each time
-- a member deletes a comment of their own, the database records one
-- engagement for them, inside the same delete, the way task_files_score does
-- for a removed file (core/game.ts SCORING_TRIGGERS, core/comments.ts
-- removeComment).
--
-- What counts: a comment deleted on its own. A comment that goes because its
-- task was deleted (or because the member's account was) is not counted:
-- deleting the task was the engagement, already scored.
--
-- No new table. Safe to re-run.

create or replace function public.task_comments_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Its task is gone: the comment went with the task (or with the member's
  -- account, which takes their tasks too).
  if not exists (select 1 from public.tasks t where t.id = old.task_id) then
    return null;
  end if;
  -- The member's account is being deleted, and their comments with it.
  if not exists (select 1 from auth.users u where u.id = old.owner_id) then
    return null;
  end if;
  perform public.record_engagement(old.owner_id, 'deleted_a_comment', public.engagement_tool(old.tool), old.task_id);
  return null;
end;
$$;

drop trigger if exists task_comments_score on public.task_comments;
create trigger task_comments_score
  after delete on public.task_comments
  for each row execute function public.task_comments_score();

revoke execute on function public.task_comments_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
