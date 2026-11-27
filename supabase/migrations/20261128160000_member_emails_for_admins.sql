-- Member emails for admins (WC-260; Dane, 2026-11-27: "Give admin user
-- ability to see email address in Members CRUD. If possible, also include a
-- column to indicate whether it is a Google login or email.")
--
-- list_member_emails() hands back every member's email address and how they
-- sign in (the providers on their account: 'google', 'email', or both). It
-- is for an admin only, the same rule as maySeeMemberEmails in
-- core/members.ts, and the database itself refuses anyone else with code
-- 42501, so hiding the column on screen is never the only guard.
--
-- list_members() is unchanged and still carries no address: an email leaves
-- the database only through this function, and only to an admin.
--
-- It reads auth.users and auth.identities, which no member can read
-- directly, so it runs as security definer with an empty search path, as
-- list_members does. It runs through the admin's own session: no service
-- key. No new table. Safe to re-run.

create or replace function public.list_member_emails()
returns table (member_id uuid, email text, providers text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.member_role(auth.uid()) is distinct from 'admin' then
    raise exception 'Only an admin can see members'' email addresses.' using errcode = '42501';
  end if;
  return query
    select u.id,
           u.email::text,
           coalesce(
             nullif(array(select distinct i.provider::text from auth.identities i where i.user_id = u.id order by 1), '{}'),
             array(select distinct p.value from jsonb_array_elements_text(coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)) p order by 1)
           )
      from auth.users u
     order by u.created_at;
end;
$$;

revoke execute on function public.list_member_emails() from public, anon;
grant execute on function public.list_member_emails() to authenticated;

notify pgrst, 'reload schema';
