-- The Game leaderboard (Dane, 2026-11-25, WaveCenter task "Create
-- Leaderboard"): every member ranked by points. Plain-words explanation:
-- docs/DATA_MODEL.md, "The leaderboard".
--
-- Additive only, safe to re-run. No table is added and no row-level security
-- or grant on an existing table changes: engagements and member_profiles stay
-- each member's own. The one new function returns, per member, only totals
-- and what their profile lets other members see, the same rule as
-- list_members() and evolution_credits(): the name leaves the database only
-- for a Public profile, the avatar never for a Private one, and the bio, the
-- privacy setting, the member's id and every single engagement never do.
--
-- It returns one JSON array rather than a set of rows so the API's row limit
-- (supabase/config.toml max_rows) can never cut the board short silently.
-- The rows come in member-id order, which says nothing about anyone; core
-- (core/leaderboard.ts rankLeaderboard) ranks them.

create or replace function public.leaderboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to see the leaderboard.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'you', u.id = auth.uid(),
             'avatar', case when coalesce(p.visibility, 'anonymous') = 'private' then null else coalesce(p.avatar, 'wave') end,
             'display_name', case when p.visibility = 'public' then p.display_name else null end,
             'granular', coalesce(g.points, 0),
             'globular', coalesce(t.points, 0),
             'tasks', coalesce(t.finished, 0)
           ) order by u.id)
      from auth.users u
      left join public.member_profiles p on p.owner_id = u.id
      left join (
        select e.member_id, sum(e.points)::bigint as points
          from public.engagements e
         group by e.member_id
      ) g on g.member_id = u.id
      left join (
        select k.owner_id, sum(k.points)::bigint as points, count(*)::bigint as finished
          from public.tasks k
         where k.status = 'done'
         group by k.owner_id
      ) t on t.owner_id = u.id
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.leaderboard() from public, anon;
grant execute on function public.leaderboard() to authenticated;

notify pgrst, 'reload schema';
