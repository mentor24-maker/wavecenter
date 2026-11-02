-- Each action's four factor scores, so the Admin page can work out its
-- points by formula (Dane, 2026-11-01, 11:40 PM MT: "Let's run this as a
-- batch job that I can kick off from the Admin page. If we do that can we
-- avoid the need for API?"). The factors and the formula are in
-- docs/GRANULAR_SCORING_ALGORITHM.md; core/game.ts (granularPoints) does the
-- arithmetic. Nothing here changes any action's points: the batch job shows
-- its results first and saves them through update_scoring_rule only when an
-- admin clicks "Put these live".
--
--   effort     E, 0 to 3
--   value      V, 0 to 3
--   rarity     R, 0 to 2
--   farm_risk  F, 0 to 3
--
-- All four null means "not scored yet", and the batch leaves that action
-- alone. A rule has all four or none.
--
-- Two ways the factors change, both refusing a role without game.edit,
-- exactly as the rules' wording and points do:
--
--   set_scoring_factors  one rule's four factors (Game > Manage)
--   add_scoring_rule     now also takes the new action's factors
--
-- The table's row-level security is unchanged: members read, nobody writes
-- it directly. Additive and safe to re-run: the fill below only touches a
-- rule that has no factors yet.

alter table public.game_scoring_rules add column if not exists effort smallint;
alter table public.game_scoring_rules add column if not exists value smallint;
alter table public.game_scoring_rules add column if not exists rarity smallint;
alter table public.game_scoring_rules add column if not exists farm_risk smallint;

-- The ranges core checks (core/game.ts FACTOR_MAX). The "is not null"s are
-- needed: a null makes "between" unknown, and a check passes on unknown.
alter table public.game_scoring_rules drop constraint if exists game_scoring_rules_factors;
alter table public.game_scoring_rules add constraint game_scoring_rules_factors check (
  (effort is null and value is null and rarity is null and farm_risk is null)
  or (effort is not null and value is not null and rarity is not null and farm_risk is not null
      and effort between 0 and 3 and value between 0 and 3 and rarity between 0 and 2 and farm_risk between 0 and 3)
);

-- The factors docs/GRANULAR_SCORING_ALGORITHM.md gives every action listed
-- today (a test keeps the two in step).
update public.game_scoring_rules r
   set effort = v.effort, value = v.value, rarity = v.rarity, farm_risk = v.farm_risk
  from (values
  ('made_task',                         1, 2, 0, 3),
  ('changed_task',                      1, 1, 0, 3),
  ('finished_task',                     3, 3, 1, 3),
  ('deleted_task',                      0, 1, 0, 3),
  ('attached_file',                     1, 2, 0, 3),
  ('removed_file',                      0, 1, 0, 3),
  ('handed_to_agents',                  0, 2, 1, 2),
  ('switched_agents',                   0, 0, 0, 3),
  ('changed_profile',                   1, 1, 1, 3),
  ('voted_on_task',                     1, 2, 0, 3),
  ('posted_a_comment',                  1, 2, 0, 3),
  ('edited_a_comment',                  1, 1, 0, 3),
  ('deleted_a_comment',                 0, 1, 0, 3),
  ('send_a_message_to_another_member',  1, 1, 0, 2),
  ('made_a_team',                       1, 2, 1, 3),
  ('changed_a_team',                    1, 1, 0, 3),
  ('deleted_a_team',                    0, 1, 1, 3),
  ('added_a_member_to_a_team',          0, 2, 0, 3),
  ('removed_a_member_from_a_team',      0, 1, 0, 3),
  ('changed_a_member_s_role',           1, 2, 1, 3),
  ('approved_a_proposed_task',          1, 2, 0, 2),
  ('joined_wavecenter',                 1, 1, 2, 1),
  ('changed_a_scoring_rule',            1, 2, 1, 3),
  ('added_a_scoring_action',            1, 2, 1, 2)
  ) as v (kind, effort, value, rarity, farm_risk)
 where r.kind = v.kind and r.effort is null;

-- Change one rule's four factors. All four null clears them ("not scored yet").
create or replace function public.set_scoring_factors(
  rule_kind text, new_effort integer, new_value integer, new_rarity integer, new_farm_risk integer, tool text
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
  update public.game_scoring_rules
     set effort = new_effort,
         value = new_value,
         rarity = new_rarity,
         farm_risk = new_farm_risk,
         tool = btrim(set_scoring_factors.tool),
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

-- add_scoring_rule gains the new action's factors. Each defaults to null, so
-- a caller that names only the first six still works while the site deploys.
drop function if exists public.add_scoring_rule(text, text, text, text, integer, text);

create or replace function public.add_scoring_rule(
  new_kind text, new_name text, new_description text, new_criteria text, new_points integer, tool text,
  new_effort integer default null, new_value integer default null, new_rarity integer default null, new_farm_risk integer default null
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
  insert into public.game_scoring_rules (kind, name, description, criteria, points, position, tool, changed_by, effort, value, rarity, farm_risk)
  values (
    new_kind, btrim(new_name), btrim(coalesce(new_description, '')), btrim(coalesce(new_criteria, '')), new_points,
    (select coalesce(max(position), 0) + 1 from public.game_scoring_rules),
    btrim(add_scoring_rule.tool), caller, new_effort, new_value, new_rarity, new_farm_risk
  )
  returning * into saved;
  return saved;
end;
$$;

revoke execute on function public.set_scoring_factors(text, integer, integer, integer, integer, text) from public, anon;
revoke execute on function public.add_scoring_rule(text, text, text, text, integer, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.set_scoring_factors(text, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.add_scoring_rule(text, text, text, text, integer, text, integer, integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';
