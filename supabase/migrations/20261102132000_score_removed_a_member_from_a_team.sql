-- "Removed a member from a team" now earns its points (Dane, 2026-11-01: "1
-- point per task is fine for now"). The sweep listed it
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet". Core's side is removeTeamMember in core/teams.ts;
-- SCORING_TRIGGERS in core/game.ts names this function and its test.
--
-- Credited to the member who removed them, never the member removed: a
-- deleted row has no column saying who deleted it, so it is whoever is
-- signed in (auth.uid()). A row removed with the service key has no
-- signed-in member to credit, so it is removed unscored rather than refused.
--
-- Only a member taken off a team on its own counts. When a whole team is
-- deleted its member links go with it, but Postgres runs those cascaded
-- deletes' triggers at the outer level (pg_trigger_depth() is 1, not 2), so
-- the test is whether the team is still there: by the time this runs, a
-- deleted team is already gone. (Tested on the test database by
-- scripts/check_tasks_rls.mjs.)
--
-- A delete leaves no row to name its tool, so the tool sends it in the
-- x-wavecenter-tool header (public.engagement_tool); without one, the tool
-- that added the member is named.
--
-- The engagement is written inside the same save as the removal, so if it
-- cannot be written the member stays on the team. No new table. Safe to
-- re-run.

create or replace function public.team_members_score_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remover uuid := auth.uid();
begin
  if v_remover is null or not exists (select 1 from public.teams t where t.id = old.team_id) then
    return null;
  end if;
  perform public.record_engagement(v_remover, 'removed_a_member_from_a_team', public.engagement_tool(old.tool), null);
  return null;
end;
$$;

drop trigger if exists team_members_score_removed on public.team_members;
create trigger team_members_score_removed
  after delete on public.team_members
  for each row execute function public.team_members_score_removed();

revoke execute on function public.team_members_score_removed() from public, anon, authenticated;

notify pgrst, 'reload schema';
