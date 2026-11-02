-- Evolution cards credit their creator (Dane, 2026-11-01, from the WaveCenter
-- task "In the evolution slider, add the creator user name and avatar an
-- point values"). Each card links to the WaveCenter task behind it; the card
-- shows that task's owner (avatar, and name when their profile is Public) and
-- the task's own points. Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only, safe to re-run. Row-level security and the grants on
-- evolution_entries are unchanged (members read, only the Mac Mini's script
-- writes); member_profiles stays owner-read-only, and the one new function
-- returns just the avatar, the name a Public profile shows, and the points.

-- The card-to-task link. A deleted task leaves the card with no creator.
alter table public.evolution_entries
  add column if not exists task_id uuid references public.tasks (id) on delete set null;

create index if not exists evolution_entries_task_id_idx on public.evolution_entries (task_id);

-- Fill it for the cards whose thread already links to their WaveCenter task
-- (/tasks/<id>, from the ticket's "WaveCenter task:" line). A link to a task
-- that is gone is left empty rather than refused.
update public.evolution_entries e
   set task_id = substring(e.thread_url from '^/tasks/([0-9a-f-]{36})$')::uuid
 where e.task_id is null
   and e.thread_url ~ '^/tasks/[0-9a-f-]{36}$'
   and exists (select 1 from public.tasks t where t.id::text = substring(e.thread_url from '^/tasks/([0-9a-f-]{36})$'));

-- The credit on every card that has a task: the task's points and what its
-- owner's profile lets other members see. Visibility is applied here as well
-- as in core (cardCredit in core/profiles.ts): the name leaves the database
-- only for a Public profile, and the bio never does. A member who never saved
-- a profile is anonymous with the built-in avatar.
create or replace function public.evolution_credits()
returns table (commit_sha text, points integer, avatar text, display_name text, visibility text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to see who made each change.' using errcode = '42501';
  end if;
  return query
    select e.commit_sha,
           t.points,
           coalesce(p.avatar, 'wave'),
           case when p.visibility = 'public' then p.display_name else null end,
           coalesce(p.visibility, 'anonymous')
      from public.evolution_entries e
      join public.tasks t on t.id = e.task_id
      left join public.member_profiles p on p.owner_id = t.owner_id;
end;
$$;

revoke execute on function public.evolution_credits() from public, anon;
grant execute on function public.evolution_credits() to authenticated;

notify pgrst, 'reload schema';
