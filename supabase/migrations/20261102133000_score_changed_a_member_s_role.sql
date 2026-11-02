-- "Changed a member's role" now earns its points (Dane, 2026-11-01: "1
-- point per task is fine for now"). The sweep listed it
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet". Core's side is setMemberRole in core/members.ts;
-- SCORING_TRIGGERS in core/game.ts names this function and its test.
--
-- What counts: a member's role saved as a different role. A member with no
-- row is a contributor, so a first row saying "contributor" is no change, and
-- neither is saving the role a member already has.
--
-- Credited to the admin who changed it, never the member whose role changed:
-- changed_by, which set_member_role stamps from the signed-in member. Only
-- when that is who is signed in now, so a row written with the service key
-- (as the first admin was made) is saved unscored rather than refused, and
-- never credited to whichever admin last touched it.
--
-- The engagement is written inside the same save as the role, so if it
-- cannot be written the role does not change either. No new table. Safe to
-- re-run.

create or replace function public.member_roles_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_role text := case when tg_op = 'UPDATE' then old.role else 'contributor' end;
begin
  if new.role is distinct from before_role
     and new.changed_by is not null and new.changed_by = auth.uid() then
    perform public.record_engagement(new.changed_by, 'changed_a_member_s_role', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists member_roles_score on public.member_roles;
create trigger member_roles_score
  after insert or update on public.member_roles
  for each row execute function public.member_roles_score();

revoke execute on function public.member_roles_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
