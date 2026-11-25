-- Changing, publishing and deleting a page of the website (WC-207; the plan
-- is docs/WEBSITE_MANAGER.md). 20261124120000_site_pages.sql granted only
-- reading and adding a page; this grants the rest, to the same people: a
-- role with the Manage website permission (site.edit, admin only to start).
--
--   update  a page's name, its address (slug) and whether it is published.
--           Nothing else: who made it, when, the tool and its sections stay
--           as they are (the sections are the editor's, a later ticket).
--   delete  a whole page.
--
-- The rules live in core/website.ts (changeSitePage, deleteSitePage); the
-- database repeats them so a client that went around core still cannot
-- break them. The table's own checks (a name of 1 to 80 characters, a
-- well-formed address, one page per address) already hold for a change.
-- A change stamps updated_at; never what the browser sent.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

grant update (name, slug, is_published) on public.site_pages to authenticated;
grant delete on public.site_pages to authenticated;

drop policy if exists "site_pages: a website manager changes a page" on public.site_pages;
drop policy if exists "site_pages: a website manager deletes a page" on public.site_pages;

create policy "site_pages: a website manager changes a page" on public.site_pages
  for update to authenticated
  using ((select private.may('site.edit')))
  with check ((select private.may('site.edit')));
create policy "site_pages: a website manager deletes a page" on public.site_pages
  for delete to authenticated using ((select private.may('site.edit')));

-- Stamp when a page last changed. Who made it and when are kept by the
-- column grants above, not here: copying old.created_by back in would undo
-- "on delete set null" when the maker's account is deleted, and block it.
create or replace function public.site_pages_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists site_pages_touch on public.site_pages;
create trigger site_pages_touch before update on public.site_pages
  for each row execute function public.site_pages_touch();

notify pgrst, 'reload schema';
