-- "Joined WaveCenter" now earns its points (Dane, 2026-11-01: "1 point per
-- task is fine for now"). The sweep listed it
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet". Core's side is newAccountData in core/accounts.ts,
-- which register in app/auth/actions.ts sends with the new account;
-- SCORING_TRIGGERS in core/game.ts names this function and its test.
--
-- Credited to the new member. The tool is the one named in the account's
-- user metadata; an account made without one (the service key, an invite)
-- names 'supabase-auth' rather than being refused.
--
-- The engagement is written inside the same save as the account, so if it
-- cannot be written the account is not made either. Only accounts made after
-- this migration count. No new table. Safe to re-run.

create or replace function public.auth_users_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_engagement(
    new.id,
    'joined_wavecenter',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'tool'), ''), 'supabase-auth'),
    null
  );
  return null;
end;
$$;

drop trigger if exists auth_users_score on auth.users;
create trigger auth_users_score
  after insert on auth.users
  for each row execute function public.auth_users_score();

revoke execute on function public.auth_users_score() from public, anon, authenticated;
