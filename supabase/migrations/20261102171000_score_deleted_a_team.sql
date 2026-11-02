-- The game layer: deleting a team now earns its point. The "Deleted a team"
-- action was listed by the sweep (20261102120000_scoring_actions_sweep.sql)
-- but nothing recorded it, so it showed "Not active yet" on Game > Manage.
-- Dane chose (B) on the sweep ticket: list every action, then wire each one
-- in its own ticket.
--
-- Credited to the member who deleted the team (auth.uid(), the signed-in
-- member making the delete, who need not be the team's maker), worth what
-- the rule says at that moment. A delete leaves no row to name its tool, so
-- the tool sends it in the x-wavecenter-tool header (app/lib/teamStore.ts),
-- read by public.engagement_tool; without one, the tool that last changed
-- the team is named. It runs inside the same delete, so a team goes and its
-- engagement lands together or not at all. Its member links go with it by
-- cascade; nothing scores those. A team deleted with the service key has no
-- member to credit, so it earns nothing rather than failing the delete.
-- Only deletes after this runs count; nothing is backfilled.
--
-- No new table. Safe to re-run.

create or replace function public.teams_score_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null then
    perform public.record_engagement(v_member, 'deleted_a_team', public.engagement_tool(old.tool), null);
  end if;
  return null;
end;
$$;

drop trigger if exists teams_score_delete on public.teams;
create trigger teams_score_delete
  after delete on public.teams
  for each row execute function public.teams_score_delete();

revoke execute on function public.teams_score_delete() from public, anon, authenticated;

notify pgrst, 'reload schema';
