-- "Changed a team" earns its point (Dane, 2026-11-01: "1 point per task is
-- fine for now"). The sweep (20261102120000_scoring_actions_sweep.sql) listed
-- the action; this wires it. Every saved change to a team's name, slug or
-- description records one engagement for the member who made it, inside the
-- same save, so the change and its point land together or not at all.
--
-- A save that changes nothing is not scored. A change with no signed-in
-- member behind it (a script on the service key) has nobody to credit, so it
-- records nothing. Core's in-memory store applies the same rule
-- (core/memoryTeamStore.ts), and core/teams.test.ts proves it.
--
-- No new table. Safe to re-run.

create or replace function public.teams_score_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (new.name, new.slug, new.description) is distinct from (old.name, old.slug, old.description) then
    perform public.record_engagement(auth.uid(), 'changed_a_team', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists teams_score_change on public.teams;
create trigger teams_score_change
  after update on public.teams
  for each row execute function public.teams_score_change();

revoke execute on function public.teams_score_change() from public, anon, authenticated;

notify pgrst, 'reload schema';
