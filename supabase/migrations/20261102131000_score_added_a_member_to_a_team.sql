-- "Added a member to a team" now earns its points (Dane, 2026-11-01: "1
-- point per task is fine for now"). The sweep listed it
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet". Core's side is addTeamMember in core/teams.ts;
-- SCORING_TRIGGERS in core/game.ts names this function and its test.
--
-- Credited to the member who added them, never the member added: added_by,
-- which team_members_stamp sets from the signed-in member just before the
-- row is saved. A row added with the service key has no signed-in member to
-- credit, so it is saved unscored rather than refused.
--
-- The engagement is written inside the same save as the team member, so if
-- it cannot be written the member is not added either. No new table. Safe to
-- re-run.

create or replace function public.team_members_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.added_by is not null then
    perform public.record_engagement(new.added_by, 'added_a_member_to_a_team', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists team_members_score on public.team_members;
create trigger team_members_score
  after insert on public.team_members
  for each row execute function public.team_members_score();

revoke execute on function public.team_members_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
