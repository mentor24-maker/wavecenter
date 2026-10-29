-- Close a leak in 20261029120000_member_roles.sql: public.member_role(uuid)
-- was security definer and callable by every signed-in member through the
-- API (POST /rest/v1/rpc/member_role), so any member could read any other
-- member's role, around the member_roles read rule ("a member reads their own
-- row; an admin reads every row").
--
-- The helper moves to a `private` schema, which the API does not expose, so
-- nobody can call it directly. The member_roles read policy and the two
-- functions that need it (set_member_role, list_members) call the private
-- copy; the public one is dropped. Nothing else changes: same rules, same
-- results for every legitimate caller.
--
-- Safe to re-run: every statement checks before it creates or drops.

create schema if not exists private;
revoke all on schema private from public, anon;
-- A row-level security policy runs as the member reading the table, so the
-- member needs to be able to reach the helper the policy calls. The schema is
-- still not exposed through the API, so it cannot be called from outside.
grant usage on schema private to authenticated;

-- A member's role, contributor if they have no row. Security definer so the
-- policy below can ask it without reading member_roles through itself.
create or replace function private.member_role(member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role from public.member_roles where member_id = member), 'contributor');
$$;

revoke execute on function private.member_role(uuid) from public, anon;
grant execute on function private.member_role(uuid) to authenticated;

-- The read rule, unchanged in meaning. The inner selects make Postgres work
-- out the caller's role once per query, not once per row.
drop policy if exists "member_roles: own row or admin can read" on public.member_roles;
create policy "member_roles: own row or admin can read" on public.member_roles
  for select to authenticated
  using ((select auth.uid()) = member_id or (select private.member_role((select auth.uid()))) = 'admin');

-- The one way a role changes: as in 20261029120000, now asking the private
-- helper.
create or replace function public.set_member_role(member uuid, new_role text, tool text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You are signed out, so no role was changed.' using errcode = '42501';
  end if;
  if tool is null or length(btrim(tool)) = 0 then
    raise exception 'Every change must name the tool making it, and none was given.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.member_roles'));
  if private.member_role(caller) <> 'admin' then
    raise exception 'Only an admin can change a member''s role.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles where key = new_role) then
    raise exception '"%" is not one of WaveCenter''s roles.', new_role using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = member) then
    raise exception 'There is no such member.' using errcode = '22023';
  end if;
  if private.member_role(member) = 'admin' and new_role <> 'admin'
     and (select count(*) from public.member_roles where role = 'admin') <= 1 then
    raise exception 'This is the last admin, so their role cannot change. Make another member an admin first.' using errcode = '22023';
  end if;
  insert into public.member_roles (member_id, role, tool, changed_by, updated_at)
  values (member, new_role, btrim(tool), caller, now())
  on conflict (member_id) do update
    set role = excluded.role, tool = excluded.tool, changed_by = excluded.changed_by, updated_at = excluded.updated_at;
  return new_role;
end;
$$;

-- Every member, for the Members page: as in 20261029120000, now asking the
-- private helper.
create or replace function public.list_members()
returns table (member_id uuid, role text, avatar text, display_name text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.member_role(auth.uid()) <> 'admin' then
    raise exception 'Only an admin can see the list of members.' using errcode = '42501';
  end if;
  return query
    select u.id,
           coalesce(r.role, 'contributor'),
           case when coalesce(p.visibility, 'anonymous') = 'private' then null else coalesce(p.avatar, 'wave') end,
           case when p.visibility = 'public' then p.display_name else null end,
           u.created_at
      from auth.users u
      left join public.member_roles r on r.member_id = u.id
      left join public.member_profiles p on p.owner_id = u.id
     order by u.created_at;
end;
$$;

-- Nothing uses the public copy any more, and it is the leak.
drop function if exists public.member_role(uuid);

notify pgrst, 'reload schema';
