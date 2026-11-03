-- The first anti-farming step, before other members are invited. Farm risk
-- no longer takes points away, so two easy loops paid every time round. This
-- closes the two that docs/GRANULAR_SCORING_ALGORITHM.md ("Safeguards the
-- formula cannot give") names, and nothing more (Dane, 2026-11-02: "In time,
-- we will be adding more sophisticated anti-farming behavior negative
-- scores." That larger design is his, later).
--
-- 1. A task earns "Finished a task" once. Finishing it again after reopening
--    it is "Changed a task", so done, reopen, done no longer pays the finish
--    each round. The ledger is the record of whether it has finished before.
-- 2. A save that changes nothing records nothing. A task saved with every
--    field as it was, a profile saved as it was, and the AI agents switch
--    saved at the setting it already had are not actions. The stamps a save
--    puts on for itself (updated_at, tool, and completed_at, which only moves
--    with the status) do not count as changes. Teams, scoring rules,
--    comments and member roles already skipped an unchanged save.
--
-- Core applies the same rules: engagementKindForTask and taskChanged in
-- core/game.ts, profileChanged in core/profiles.ts; core/game.test.ts proves
-- them. No new table, no change to any rule or points. Safe to re-run.

-- What the "has this task finished before?" question reads, kept quick.
create index if not exists engagements_finished_task_idx
  on public.engagements (task_id) where kind = 'finished_task';

create or replace function public.tasks_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_owner uuid := coalesce(new.owner_id, old.owner_id);
begin
  -- The member's account is being deleted, and their tasks with it.
  if not exists (select 1 from auth.users u where u.id = v_owner) then
    return null;
  end if;
  -- The vote trigger (task_votes_apply) is putting the members' average on
  -- the task: that is the voter's engagement, already scored, not the
  -- owner's.
  if coalesce(current_setting('wavecenter.vote_apply', true), '') = 'on' then
    return null;
  end if;
  -- evolution_backfill_task is giving an old Evolution card its task:
  -- nobody made a task just now, so nothing is scored.
  if coalesce(current_setting('wavecenter.backfill', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_engagement(new.owner_id, 'made_task', new.tool, new.id);
  elsif tg_op = 'DELETE' then
    perform public.record_engagement(old.owner_id, 'deleted_task', public.engagement_tool(old.tool), old.id);
  else
    -- Saved with nothing different: not an action, so nothing is scored.
    if (to_jsonb(new) - 'updated_at' - 'tool' - 'completed_at')
       = (to_jsonb(old) - 'updated_at' - 'tool' - 'completed_at') then
      return null;
    end if;
    -- Its parent was just deleted and the database let it go: that delete
    -- was the engagement, already scored.
    if old.parent_task_id is not null and new.parent_task_id is null
       and not exists (select 1 from public.tasks t where t.id = old.parent_task_id) then
      return null;
    end if;
    if new.agent_ticket_url is not null and old.agent_ticket_url is null then
      v_kind := 'handed_to_agents';
    elsif new.status = 'done' and old.status is distinct from 'done'
          and not exists (select 1 from public.engagements e
                          where e.task_id = new.id and e.kind = 'finished_task') then
      v_kind := 'finished_task';
    else
      v_kind := 'changed_task';
    end if;
    perform public.record_engagement(new.owner_id, v_kind, new.tool, new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.tasks_score() from public, anon, authenticated;

create or replace function public.member_profiles_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A first save always counts; a later one only if something differs.
  if tg_op = 'UPDATE'
     and (new.display_name, new.avatar, new.bio, new.visibility)
         is not distinct from (old.display_name, old.avatar, old.bio, old.visibility) then
    return null;
  end if;
  perform public.record_engagement(new.owner_id, 'changed_profile', new.tool, null);
  return null;
end;
$$;
revoke execute on function public.member_profiles_score() from public, anon, authenticated;

create or replace function public.member_settings_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Saving the switch at the setting it already had is not a flip.
  if tg_op = 'UPDATE' and new.agents_on is not distinct from old.agents_on then
    return null;
  end if;
  perform public.record_engagement(new.owner_id, 'switched_agents', new.tool, null);
  return null;
end;
$$;
revoke execute on function public.member_settings_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
