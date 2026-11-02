-- The game layer: posting a comment on a task now earns its point. The
-- "Posted a comment" action was listed by the sweep
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet" on Game > Manage. Dane chose (B) on the sweep
-- ticket: list every action, then wire each one in its own ticket.
--
-- Credited to the member who wrote the comment, worth what the rule says at
-- that moment, naming the tool that wrote it and the task it is on. It runs
-- inside the same save, so a comment and its engagement land together or not
-- at all. Only comments posted after this runs count; nothing is backfilled.
--
-- No new table. Safe to re-run.

create or replace function public.task_comments_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_engagement(new.owner_id, 'posted_a_comment', new.tool, new.task_id);
  return null;
end;
$$;

drop trigger if exists task_comments_score on public.task_comments;
create trigger task_comments_score
  after insert on public.task_comments
  for each row execute function public.task_comments_score();

revoke execute on function public.task_comments_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
