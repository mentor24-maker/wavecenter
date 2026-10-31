-- Game management (Dane, 2026-10-30: "allows an admin user to add specific
-- actions that trigger points and the point values associated with it ...
-- if an admin user adds a score, it is immediately active"; on the ticket he
-- chose option B: admins also add new actions, each inactive until an agent
-- wires it to a function and a test). Until now the scoring rules changed
-- only in a migration.
--
--   game.edit  Manage game scoring  admin only
--
-- Two functions are the only ways a rule changes, and both refuse a role
-- without game.edit:
--
--   update_scoring_rule  a rule's name, description, criteria and points
--   add_scoring_rule     a new action, at the end of the list
--
-- Members still cannot write game_scoring_rules directly through the API,
-- and nobody can delete a rule. A change counts from the next engagement:
-- every engagement already copied its points when it happened, so nothing
-- earned is rewritten. A new action's kind is never recorded until a trigger
-- calls record_engagement with it, which needs a migration.
--
-- The rules live in core/game.ts (changeScoringRule, addScoringRule) and
-- core/members.ts (PERMISSIONS, STARTING_ROLE_PERMISSIONS); tests keep this
-- file in step with them. No new table. Additive and safe to re-run.

insert into public.permissions (key, label, position) values
  ('game.edit', 'Manage game scoring', 9)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin',       'game.edit')
on conflict do nothing;

-- Who last changed each rule, and with which tool. The seeded rules were set
-- by a migration.
alter table public.game_scoring_rules add column if not exists tool text not null default 'migration';
alter table public.game_scoring_rules add column if not exists changed_by uuid references auth.users (id) on delete set null;

-- The lengths core checks (core/game.ts RULE_NAME_MAX, RULE_TEXT_MAX).
alter table public.game_scoring_rules drop constraint if exists game_scoring_rules_lengths;
alter table public.game_scoring_rules add constraint game_scoring_rules_lengths
  check (length(name) <= 80 and length(description) <= 500 and length(criteria) <= 500);

-- Does the caller's role have game.edit? Raises if not, so both functions
-- below refuse the same way.
create or replace function private.require_game_edit(tool text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You are signed out, so no scoring rule was changed.' using errcode = '42501';
  end if;
  if tool is null or length(btrim(tool)) = 0 then
    raise exception 'Every change must name the tool making it, and none was given.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.role_permissions rp
     where rp.role = private.member_role(caller) and rp.permission = 'game.edit'
  ) then
    raise exception 'Only an admin can manage the game scoring. Nothing was saved.' using errcode = '42501';
  end if;
  return caller;
end;
$$;

revoke execute on function private.require_game_edit(text) from public, anon;
grant execute on function private.require_game_edit(text) to authenticated;

-- Change one rule's wording and points.
create or replace function public.update_scoring_rule(
  rule_kind text, new_name text, new_description text, new_criteria text, new_points integer, tool text
)
returns public.game_scoring_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_game_edit(tool);
  saved public.game_scoring_rules;
begin
  if new_points is null or new_points < 0 then
    raise exception 'Points must be a whole number from 0 up. Nothing was saved.' using errcode = '22023';
  end if;
  if new_name is null or length(btrim(new_name)) = 0 then
    raise exception 'Every action needs a name. Nothing was saved.' using errcode = '22023';
  end if;
  update public.game_scoring_rules
     set name = btrim(new_name),
         description = btrim(coalesce(new_description, '')),
         criteria = btrim(coalesce(new_criteria, '')),
         points = new_points,
         tool = btrim(update_scoring_rule.tool),
         changed_by = caller,
         updated_at = now()
   where kind = rule_kind
  returning * into saved;
  if not found then
    raise exception 'There is no action "%" to change.', rule_kind using errcode = '22023';
  end if;
  return saved;
end;
$$;

-- Add a new action at the end of the list. The kind comes from core's
-- kindFromName; the table's own check allows only a-z and _.
create or replace function public.add_scoring_rule(
  new_kind text, new_name text, new_description text, new_criteria text, new_points integer, tool text
)
returns public.game_scoring_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_game_edit(tool);
  saved public.game_scoring_rules;
begin
  if new_points is null or new_points < 0 then
    raise exception 'Points must be a whole number from 0 up. Nothing was saved.' using errcode = '22023';
  end if;
  if new_name is null or length(btrim(new_name)) = 0 then
    raise exception 'Every action needs a name. Nothing was saved.' using errcode = '22023';
  end if;
  if new_kind is null or new_kind !~ '^[a-z_]+$' then
    raise exception '"%" cannot be the kind of an action: only a to z and _ are allowed.', new_kind using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.game_scoring_rules'));
  if exists (select 1 from public.game_scoring_rules where kind = new_kind) then
    raise exception 'There is already an action "%". Nothing was saved.', new_kind using errcode = '23505';
  end if;
  insert into public.game_scoring_rules (kind, name, description, criteria, points, position, tool, changed_by)
  values (
    new_kind, btrim(new_name), btrim(coalesce(new_description, '')), btrim(coalesce(new_criteria, '')), new_points,
    (select coalesce(max(position), 0) + 1 from public.game_scoring_rules),
    btrim(add_scoring_rule.tool), caller
  )
  returning * into saved;
  return saved;
end;
$$;

revoke execute on function public.update_scoring_rule(text, text, text, text, integer, text) from public, anon;
revoke execute on function public.add_scoring_rule(text, text, text, text, integer, text) from public, anon;
grant execute on function public.update_scoring_rule(text, text, text, text, integer, text) to authenticated;
grant execute on function public.add_scoring_rule(text, text, text, text, integer, text) to authenticated;

notify pgrst, 'reload schema';
