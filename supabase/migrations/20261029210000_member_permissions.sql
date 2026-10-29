-- Member permissions (Dane, 2026-10-29, on "Dane cannot filter, sort or act
-- on members from one table": "Only admins will get edit/delete
-- functionality under the Actions column. Other members get view
-- functionality"). Two new permissions join the four task ones:
--
--   member.read  View members         every role
--   member.edit  Change member roles  admin only
--
-- list_members now lets in any signed-in member whose role has member.read,
-- instead of admins only. It still shows only what each member's profile lets
-- other members see, and never an email address. Changing a role is
-- unchanged: set_member_role still allows an admin only.
--
-- The rules live in core/members.ts (PERMISSIONS, STARTING_ROLE_PERMISSIONS);
-- a test keeps this file in step with them. No new table. Additive and safe
-- to re-run: every insert skips rows already there.

insert into public.permissions (key, label, position) values
  ('member.read', 'View members',        5),
  ('member.edit', 'Change member roles', 6)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin',       'member.read'), ('admin', 'member.edit'),
  ('editor',      'member.read'),
  ('contributor', 'member.read'),
  ('reviewer',    'member.read'),
  ('viewer',      'member.read')
on conflict do nothing;

-- Every member, for the Members page: as in 20261029180000, now open to any
-- role with member.read. The grants table is named rp because the function's
-- own output has a column called role, and a bare "role" would be ambiguous.
create or replace function public.list_members()
returns table (member_id uuid, role text, avatar text, display_name text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.role_permissions rp
     where rp.role = private.member_role(auth.uid()) and rp.permission = 'member.read'
  ) then
    raise exception 'Your role may not see the list of members.' using errcode = '42501';
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

notify pgrst, 'reload schema';
