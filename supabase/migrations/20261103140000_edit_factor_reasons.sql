-- An admin writes or changes the reason behind each factor score on
-- Game > Manage, and gives a new action its reasons when adding it. The
-- reasons themselves came in 20261103120000_scoring_factor_reasons.sql.
--
-- Two ways the reasons change, both refusing a role without game.edit,
-- exactly as the factors do (20261102180000_scoring_factors.sql):
--
--   set_scoring_factor_reasons  one rule's four reasons (Game > Manage)
--   add_scoring_rule            now also takes the new action's reasons
--
-- Each reason is trimmed; a blank one is stored as null ("no reason written
-- yet"). One over 300 characters is refused, the same limit core holds
-- (core/game.ts REASON_MAX). The reasons change no points, and the scoring
-- trigger for "Changed a scoring rule" does not fire on them.
--
-- The table's row-level security is unchanged: members read, nobody writes
-- it directly. Safe to re-run.

alter table public.game_scoring_rules drop constraint if exists game_scoring_rules_reason_length;
alter table public.game_scoring_rules add constraint game_scoring_rules_reason_length check (
  coalesce(char_length(effort_reason), 0) <= 300 and coalesce(char_length(value_reason), 0) <= 300
  and coalesce(char_length(rarity_reason), 0) <= 300 and coalesce(char_length(farm_risk_reason), 0) <= 300
);

-- One reason, trimmed, blank as null, and refused over 300 characters.
create or replace function private.factor_reason(reason text, what text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  trimmed text := nullif(btrim(reason), '');
begin
  if char_length(trimmed) > 300 then
    raise exception 'The % reason can be at most 300 characters; this one is %. Nothing was saved.', what, char_length(trimmed) using errcode = '22023';
  end if;
  return trimmed;
end;
$$;

revoke execute on function private.factor_reason(text, text) from public, anon, authenticated;

-- Change one rule's four reasons. A null or blank one clears it.
create or replace function public.set_scoring_factor_reasons(
  rule_kind text, new_effort_reason text, new_value_reason text, new_rarity_reason text, new_farm_risk_reason text, tool text
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
     set effort_reason = private.factor_reason(new_effort_reason, 'Effort'),
         value_reason = private.factor_reason(new_value_reason, 'Value'),
         rarity_reason = private.factor_reason(new_rarity_reason, 'Rarity'),
         farm_risk_reason = private.factor_reason(new_farm_risk_reason, 'Farm risk'),
         tool = btrim(set_scoring_factor_reasons.tool),
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

-- add_scoring_rule gains the new action's reasons. Each defaults to null, so
-- a caller that names only the first ten still works while the site deploys.
drop function if exists public.add_scoring_rule(text, text, text, text, integer, text, integer, integer, integer, integer);

create or replace function public.add_scoring_rule(
  new_kind text, new_name text, new_description text, new_criteria text, new_points integer, tool text,
  new_effort integer default null, new_value integer default null, new_rarity integer default null, new_farm_risk integer default null,
  new_effort_reason text default null, new_value_reason text default null, new_rarity_reason text default null, new_farm_risk_reason text default null
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
  insert into public.game_scoring_rules (
    kind, name, description, criteria, points, position, tool, changed_by, effort, value, rarity, farm_risk,
    effort_reason, value_reason, rarity_reason, farm_risk_reason
  )
  values (
    new_kind, btrim(new_name), btrim(coalesce(new_description, '')), btrim(coalesce(new_criteria, '')), new_points,
    (select coalesce(max(position), 0) + 1 from public.game_scoring_rules),
    btrim(add_scoring_rule.tool), caller, new_effort, new_value, new_rarity, new_farm_risk,
    private.factor_reason(new_effort_reason, 'Effort'), private.factor_reason(new_value_reason, 'Value'),
    private.factor_reason(new_rarity_reason, 'Rarity'), private.factor_reason(new_farm_risk_reason, 'Farm risk')
  )
  returning * into saved;
  return saved;
end;
$$;

revoke execute on function public.set_scoring_factor_reasons(text, text, text, text, text, text) from public, anon;
revoke execute on function public.add_scoring_rule(text, text, text, text, integer, text, integer, integer, integer, integer, text, text, text, text) from public, anon;
grant execute on function public.set_scoring_factor_reasons(text, text, text, text, text, text) to authenticated;
grant execute on function public.add_scoring_rule(text, text, text, text, integer, text, integer, integer, integer, integer, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
