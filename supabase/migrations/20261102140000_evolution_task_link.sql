-- Every Evolution card has a WaveCenter task behind it (Dane, 2026-11-01: "I
-- thought all cards had to have a task associated with it"). Two parts:
--
--   1. evolution_entries.task_id: the task a card belongs to. Empty until
--      scripts/evolution_backfill_tasks.mjs fills it; a deleted task leaves
--      its card with no task rather than taking the card with it.
--   2. evolution_backfill_task(): the one way that script makes a finished
--      task, owned by Dane, for a card that came from a chat request or a
--      founding commit and has none. The task is dated at its change's merge
--      time and is worth 0 points. Making it records no engagement: Dane did
--      not make a task today, so the game layer must not credit one (the
--      transaction-local setting wavecenter.backfill tells tasks_score so,
--      the same way wavecenter.vote_apply does for votes).
--
-- Plain-words explanation: docs/DATA_MODEL.md. Additive only: one empty
-- column, one new function, and tasks_score gains one check. Row-level
-- security on both tables is unchanged and stays on. Safe to re-run.

alter table public.evolution_entries
  add column if not exists task_id uuid references public.tasks (id) on delete set null;

create index if not exists evolution_entries_task_id_idx on public.evolution_entries (task_id);

-- tasks_score, as in 20261028140000_task_votes.sql, plus one check: a task
-- the Evolution backfill makes is not the owner's engagement.
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
  -- evolution_backfill_task (below) is giving an old Evolution card its
  -- task: nobody made a task just now, so nothing is scored.
  if coalesce(current_setting('wavecenter.backfill', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_engagement(new.owner_id, 'made_task', new.tool, new.id);
  elsif tg_op = 'DELETE' then
    perform public.record_engagement(old.owner_id, 'deleted_task', public.engagement_tool(old.tool), old.id);
  else
    -- Its parent was just deleted and the database let it go: that delete
    -- was the engagement, already scored.
    if old.parent_task_id is not null and new.parent_task_id is null
       and not exists (select 1 from public.tasks t where t.id = old.parent_task_id) then
      return null;
    end if;
    if new.agent_ticket_url is not null and old.agent_ticket_url is null then
      v_kind := 'handed_to_agents';
    elsif new.status = 'done' and old.status is distinct from 'done' then
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

-- Give one card its task, in one transaction: the task and the card's link
-- are saved together or not at all, so no card is left pointing at a task
-- that was not saved (engineering rule 6). A card that already has a task
-- keeps it and nothing is made (made = false, card_task = the task it has), so a second run makes
-- nothing. The task is done, 0 points, not ticked for AI agents, and dated
-- p_at: tasks_touch stamps a new done task "finished now", so the finish
-- time is put back to p_at straight after.
create or replace function public.evolution_backfill_task(
  p_commit_sha text,
  p_owner uuid,
  p_title text,
  p_notes text,
  p_at timestamptz
)
returns table (card_task uuid, made boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_task uuid;
begin
  if p_at is null then
    raise exception 'The card for change % has no merge time, so no task was made.', p_commit_sha
      using errcode = '22023';
  end if;
  select e.task_id into v_existing
    from public.evolution_entries e
    where e.commit_sha = p_commit_sha
    for update;
  if not found then
    raise exception 'There is no Evolution card for change %, so no task was made.', p_commit_sha
      using errcode = 'P0002';
  end if;
  if v_existing is not null then
    return query select v_existing, false;
    return;
  end if;

  perform set_config('wavecenter.backfill', 'on', true);
  insert into public.tasks (title, notes, owner_id, status, points, created_at, agent_selected, tool)
    values (p_title, p_notes, p_owner, 'done', 0, p_at, false, 'evolution-backfill')
    returning id into v_task;
  update public.tasks set completed_at = p_at where id = v_task;
  update public.evolution_entries set task_id = v_task where commit_sha = p_commit_sha;
  perform set_config('wavecenter.backfill', '', true);

  return query select v_task, true;
end;
$$;

-- Only the service key (the script, on the Mac Mini) may call it.
revoke execute on function public.evolution_backfill_task(text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.evolution_backfill_task(text, uuid, text, text, timestamptz) to service_role;
