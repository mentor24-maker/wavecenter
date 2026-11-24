-- The game layer: deleting a proposal now earns its point. The "Deleted a
-- proposal" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-194 for this one).
--
-- A proposal is deleted by deleting its row in proposals
-- (20261102210000_proposals.sql; removeProposal in app/proposals/actions.ts).
-- Row-level security only lets a proposal's owner delete it, so the member
-- credited is the signed-in member (auth.uid()), and only when they own the
-- row. Making and changing a proposal are their own actions
-- (made_a_proposal, changed_a_proposal) and are not scored here; the
-- sub-proposals that lose their parent in the same delete are changed, not
-- deleted, and score nothing here either.
--
-- Worth what the rule says at that moment. A delete leaves no row to name
-- its tool, so the tool sends it in the x-wavecenter-tool header
-- (app/lib/proposalStore.ts), read by public.engagement_tool; without one,
-- the tool that last changed the proposal is named. It runs inside the same
-- delete, so a proposal goes and its engagement lands together or not at
-- all; a refused delete (someone else's proposal) records nothing. A delete
-- made with the service key (no signed-in member) has nobody to credit, so
-- it earns nothing rather than failing the delete. A proposal removed
-- because its owner's account was deleted (owner_id cascades) is not
-- counted: by the time the cascaded row's trigger runs, the account row is
-- gone, so that is what the function checks. Only deletes after this runs
-- count; nothing is backfilled.
--
-- Its own function and trigger name (proposals_score_delete), so it never
-- replaces proposals_score ("Made a proposal", WC-192) or
-- proposals_score_changed ("Changed a proposal", WC-193).
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action.
--
-- No new table. Safe to re-run.

create or replace function public.proposals_score_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null or old.owner_id is distinct from v_member then
    return null;
  end if;
  -- Removed along with its owner's account: nobody chose to delete it.
  if not exists (select 1 from auth.users u where u.id = old.owner_id) then
    return null;
  end if;
  perform public.record_engagement(v_member, 'deleted_a_proposal', public.engagement_tool(old.tool), null);
  return null;
end;
$$;

drop trigger if exists proposals_score_delete on public.proposals;
create trigger proposals_score_delete
  after delete on public.proposals
  for each row execute function public.proposals_score_delete();

revoke execute on function public.proposals_score_delete() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 0, value = 1, rarity = 0, farm_risk = 3,
       effort_reason = 'One click.',
       value_reason = 'Housekeeping worth having: it tidies up the Proposals page.',
       rarity_reason = 'Proposals can be deleted many times a day.',
       farm_risk_reason = 'The undo half of the make-and-delete loop.'
 where kind = 'deleted_a_proposal'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
