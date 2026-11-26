-- One member's profile, as another member may see it (WC-238, "Member
-- profile page, linked from leaderboard names"; Dane, 2026-11-25, "3) B" on
-- WC-236). Plain-words explanation: docs/DATA_MODEL.md, "A member's profile
-- page".
--
-- Additive only, safe to re-run. No table is added and no row-level security
-- or grant on an existing table changes: member_profiles stays each member's
-- own. Two functions change or appear, both under the same visibility rule
-- as list_members(), evolution_credits() and leaderboard():
--
-- 1. member_profile(member): the shown fields of one member's profile.
--    Public: avatar, display name and bio. Anonymous (or never saved): the
--    avatar alone. Private, or no such member: null, so the two look the
--    same and the reply never says which. Never the privacy setting itself.
--
-- 2. leaderboard() gains `member_id`, the link target, on the rows of a
--    Public member with a name, and only those. An Anonymous or Private row
--    (or a Public one with no name, which the board shows as "Anonymous
--    member") still carries no id, so no link leaks a hidden member.

create or replace function public.member_profile(member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visibility text;
  v_avatar text;
  v_name text;
  v_bio text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to see a member''s profile.' using errcode = '42501';
  end if;
  if member is null or not exists (select 1 from auth.users u where u.id = member) then
    return null;
  end if;
  select p.visibility, p.avatar, p.display_name, p.bio
    into v_visibility, v_avatar, v_name, v_bio
    from public.member_profiles p
   where p.owner_id = member;
  v_visibility := coalesce(v_visibility, 'anonymous');
  if v_visibility = 'private' then
    return null;
  end if;
  return jsonb_build_object(
    'avatar', coalesce(v_avatar, 'wave'),
    'display_name', case when v_visibility = 'public' then nullif(btrim(v_name), '') else null end,
    'bio', case when v_visibility = 'public' then nullif(btrim(v_bio), '') else null end
  );
end;
$$;

revoke execute on function public.member_profile(uuid) from public, anon;
grant execute on function public.member_profile(uuid) to authenticated;

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
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'member_id', case when p.visibility = 'public' and nullif(btrim(p.display_name), '') is not null then u.id else null end
           )) || jsonb_build_object(
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
