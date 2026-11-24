-- The game layer: changing a proposal now earns its point. The "Changed a
-- proposal" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-193 for this one).
--
-- A proposal is changed by updating its row in proposals
-- (20261102210000_proposals.sql; editProposal in app/proposals/actions.ts).
-- Row-level security only lets a proposal's owner change it, so the member
-- credited is the signed-in member, and only when they own the row. Making
-- and deleting a proposal are their own actions (made_a_proposal,
-- deleted_a_proposal) and are not scored here.
--
-- Only a change to the title, notes, points, priority, status or parent
-- counts: a save that changes none of those (or only reorders the proposal)
-- records nothing. When a proposal is deleted, the database clears the
-- parent of its sub-proposals ("on delete set null"); that is part of the
-- delete, not a change anyone made, so it records nothing either.
--
-- Worth what the rule says at that moment, naming the row's own tool (the
-- tool that made this change). It runs inside the same save, so a change and
-- its engagement land together or not at all; a refused change (a blank
-- title, someone else's proposal) records nothing. A change made with the
-- service key (no signed-in member) has nobody to credit, so it earns
-- nothing rather than failing the save. Only changes made after this runs
-- count; nothing is backfilled.
--
-- Its own function and trigger name (proposals_score_changed), so it never
-- replaces proposals_score, the "Made a proposal" trigger (WC-192).
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action.
--
-- No new table. Safe to re-run.

create or replace function public.proposals_score_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null or new.owner_id is distinct from v_member then
    return null;
  end if;
  -- A sub-proposal whose parent was just deleted: only its parent changed,
  -- to nothing, and that parent is gone.
  if old.parent_proposal_id is not null and new.parent_proposal_id is null
     and (old.title, old.notes, old.points, old.priority, old.status)
         is not distinct from (new.title, new.notes, new.points, new.priority, new.status)
     and not exists (select 1 from public.proposals p where p.id = old.parent_proposal_id) then
    return null;
  end if;
  perform public.record_engagement(v_member, 'changed_a_proposal', new.tool, null);
  return null;
end;
$$;

drop trigger if exists proposals_score_changed on public.proposals;
create trigger proposals_score_changed
  after update of title, notes, points, priority, status, parent_proposal_id on public.proposals
  for each row
  when ((old.title, old.notes, old.points, old.priority, old.status, old.parent_proposal_id)
        is distinct from (new.title, new.notes, new.points, new.priority, new.status, new.parent_proposal_id))
  execute function public.proposals_score_changed();

revoke execute on function public.proposals_score_changed() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 1, rarity = 0, farm_risk = 3,
       effort_reason = 'An edit is a short form or a few words: under a minute.',
       value_reason = 'Keeps a proposal accurate, which tidies up the Proposals page.',
       rarity_reason = 'Proposals can be edited many times a day.',
       farm_risk_reason = 'Any edit can be changed straight back, so it loops.'
 where kind = 'changed_a_proposal'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
