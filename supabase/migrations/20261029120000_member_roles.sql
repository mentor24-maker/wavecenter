-- Roles and permissions (Dane, 2026-10-28, from the WaveCenter task "Build a
-- more robust member management system": a roles table with admin, editor,
-- contributor, reviewer and viewer, and an expandable permissions table that
-- starts with read, create, edit and delete task). On 2026-10-29 he chose the
-- first slice, "A": the roles and permissions are stored and shown, and an
-- admin changes members' roles. Nothing here changes what anyone may do on
-- tasks yet; the tasks row-level security rules are untouched. Enforcing the
-- permissions is a later ticket.
--
-- The rules live in core/members.ts; the function below repeats the ones that
-- guard a change (only an admin, never the last admin, a tool name) so a
-- client that went around core still cannot break them. Plain-words
-- explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

-- The roles. A new role is added by a migration, never from a screen.
create table if not exists public.roles (
  key         text    primary key check (key ~ '^[a-z][a-z_]*$'),
  name        text    not null check (length(btrim(name)) > 0),
  description text    not null check (length(btrim(description)) > 0),
  position    integer not null unique
);

-- The permissions: what a role may do. Expandable: a later migration adds a
-- row, and core/members.ts learns its key.
create table if not exists public.permissions (
  key         text    primary key check (key ~ '^[a-z]+\.[a-z_]+$'),
  label       text    not null check (length(btrim(label)) > 0),
  position    integer not null unique
);

-- Which role has which permission.
create table if not exists public.role_permissions (
  role       text not null references public.roles (key) on delete cascade,
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

-- One role per member. A member with no row is a contributor, which is what
-- every member was before roles existed.
create table if not exists public.member_roles (
  member_id  uuid        primary key references auth.users (id) on delete cascade,
  role       text        not null references public.roles (key),
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  changed_by uuid        references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment each table
-- exists. Start from no rights at all and grant only what is used.
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.member_roles     enable row level security;

revoke all on public.roles, public.permissions, public.role_permissions, public.member_roles from anon, authenticated;

-- The lists themselves: every signed-in member reads them; nobody writes them
-- from the browser.
grant select on public.roles, public.permissions, public.role_permissions to authenticated;

drop policy if exists "roles: members can read"            on public.roles;
drop policy if exists "permissions: members can read"      on public.permissions;
drop policy if exists "role_permissions: members can read" on public.role_permissions;

create policy "roles: members can read" on public.roles
  for select to authenticated using (true);
create policy "permissions: members can read" on public.permissions
  for select to authenticated using (true);
create policy "role_permissions: members can read" on public.role_permissions
  for select to authenticated using (true);

-- A member's role, contributor if they have no row. Security definer so the
-- policy below can ask it without reading member_roles through itself.
create or replace function public.member_role(member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role from public.member_roles where member_id = member), 'contributor');
$$;

revoke execute on function public.member_role(uuid) from public, anon;
grant execute on function public.member_role(uuid) to authenticated;

-- member_roles: a member reads their own row; an admin reads every row. No
-- one writes it directly: a change goes through set_member_role below.
grant select on public.member_roles to authenticated;

drop policy if exists "member_roles: own row or admin can read" on public.member_roles;
create policy "member_roles: own row or admin can read" on public.member_roles
  for select to authenticated
  using ((select auth.uid()) = member_id or public.member_role((select auth.uid())) = 'admin');

-- The one way a role changes. Only an admin may call it to effect; the last
-- admin cannot be made anything else; the change names its tool. The lock
-- makes two admins demoting each other at once take turns, so they cannot
-- both succeed and leave nobody in charge.
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
  if public.member_role(caller) <> 'admin' then
    raise exception 'Only an admin can change a member''s role.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles where key = new_role) then
    raise exception '"%" is not one of WaveCenter''s roles.', new_role using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = member) then
    raise exception 'There is no such member.' using errcode = '22023';
  end if;
  if public.member_role(member) = 'admin' and new_role <> 'admin'
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

revoke execute on function public.set_member_role(uuid, text, text) from public, anon;
grant execute on function public.set_member_role(uuid, text, text) to authenticated;

-- Every member, for the Members page: an admin only. It shows what each
-- member's profile lets other members see, and nothing more: their avatar
-- unless their profile is private, and their name only if it is public. No
-- email address ever leaves this function.
create or replace function public.list_members()
returns table (member_id uuid, role text, avatar text, display_name text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.member_role(auth.uid()) <> 'admin' then
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

revoke execute on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

-- The starting lists. Kept in step with ROLES, PERMISSIONS and
-- STARTING_ROLE_PERMISSIONS in core/members.ts (a test compares them).
insert into public.roles (key, name, description, position) values
  ('admin',       'Admin',       'Runs WaveCenter: manages members and their roles, and may do everything on tasks.', 1),
  ('editor',      'Editor',      'Reads, adds, changes and deletes tasks.',                                          2),
  ('contributor', 'Contributor', 'Reads every task, adds tasks and changes their own.',                             3),
  ('reviewer',    'Reviewer',    'Reads every task, to review the work.',                                            4),
  ('viewer',      'Viewer',      'Reads every task.',                                                                5)
on conflict (key) do nothing;

insert into public.permissions (key, label, position) values
  ('task.read',   'Read task',   1),
  ('task.create', 'Create task', 2),
  ('task.edit',   'Edit task',   3),
  ('task.delete', 'Delete task', 4)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin',       'task.read'), ('admin',       'task.create'), ('admin',  'task.edit'), ('admin',  'task.delete'),
  ('editor',      'task.read'), ('editor',      'task.create'), ('editor', 'task.edit'), ('editor', 'task.delete'),
  ('contributor', 'task.read'), ('contributor', 'task.create'), ('contributor', 'task.edit'),
  ('reviewer',    'task.read'),
  ('viewer',      'task.read')
on conflict do nothing;

-- Dane is the first admin. His account id (not his email: this repository is
-- public). On a database where that account does not exist, nobody is made
-- admin here.
insert into public.member_roles (member_id, role, tool)
select id, 'admin', 'migration' from auth.users where id = '3cb23781-b16b-4fae-93e0-85e51915641c'
on conflict (member_id) do nothing;

notify pgrst, 'reload schema';
