-- The game layer: making a team now earns its point. The "Made a team"
-- action was listed by the sweep (20261102120000_scoring_actions_sweep.sql)
-- but nothing recorded it, so it showed "Not active yet" on Game > Manage.
-- Dane chose (B) on the sweep ticket: list every action, then wire each one
-- in its own ticket.
--
-- Credited to the member who made the team (created_by, which teams_touch
-- stamps from auth.uid(), never from what the browser sent), worth what the
-- rule says at that moment, naming the tool that made it. It runs inside the
-- same save, so a team and its engagement land together or not at all. A
-- team made with the service key has no maker to credit, so it earns nothing
-- rather than failing the save. Only teams made after this runs count;
-- nothing is backfilled.
--
-- No new table. Safe to re-run.

create or replace function public.teams_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    perform public.record_engagement(new.created_by, 'made_a_team', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists teams_score on public.teams;
create trigger teams_score
  after insert on public.teams
  for each row execute function public.teams_score();

revoke execute on function public.teams_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
