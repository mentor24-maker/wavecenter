-- The website manager's pages (Dane, 2026-11-22, WC-206: "WaveCenter needs
-- it's own page builder along the lines of Starcaster and Normie. Cannibalize
-- both of those repositories to develop a new and improved version for
-- WaveCenter. Link to it from the Admin page for now."). He chose "A" on the
-- ticket: start from Normie's leaner builder. The plan is
-- docs/WEBSITE_MANAGER.md. One new table and one new permission:
--
--   site_pages  one page of WaveCenter's website, modeled on Normie's `pages`
--   site.edit   Manage website   admin only, to start
--
-- A page has a name, an address (slug: lower-case letters, digits and single
-- hyphens, unique) and its layout sections as JSON, for the editor to come.
-- A new page is a draft. Publishing, changing and deleting a page are later
-- tickets, so this migration grants only reading and adding.
--
-- Who may see a page: anyone, signed in or not, sees a published one; a
-- role with site.edit also sees drafts. Who may add one: a role with
-- site.edit, in their own name. The rules live in core/website.ts and
-- core/members.ts; the database repeats them so a client that went around
-- core still cannot break them. A test keeps the limits here in step with
-- core's (core/website.test.ts).
--
-- Additive only. Safe to re-run: every statement checks before it creates.

insert into public.permissions (key, label, position) values
  ('site.edit', 'Manage website', 12)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin', 'site.edit')
on conflict do nothing;

create table if not exists public.site_pages (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null check (length(btrim(name, E' \t\n\r\f\x0B')) between 1 and 80),
  slug            text        not null check (length(slug) <= 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- The page's sections, in the shape the editor will write (Normie's
  -- layout_sections). Empty until the editor exists.
  layout_sections jsonb       not null default '[]'::jsonb check (jsonb_typeof(layout_sections) = 'array'),
  is_published    boolean     not null default false,
  -- Who made it; stamped by the database. Deleting their account keeps the page.
  created_by      uuid        references auth.users (id) on delete set null,
  tool            text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint site_pages_slug_key unique (slug)
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights at all and grant only what is used.
alter table public.site_pages enable row level security;

revoke all on public.site_pages from anon, authenticated;
grant select on public.site_pages to anon, authenticated;
-- Only the name, the address and the tool are the caller's to give; a new
-- page is always an empty draft, and who and when are the database's.
grant insert (name, slug, tool) on public.site_pages to authenticated;

drop policy if exists "site_pages: anyone reads a published page"        on public.site_pages;
drop policy if exists "site_pages: a member reads published pages, a website manager every page" on public.site_pages;
drop policy if exists "site_pages: a website manager adds a page"        on public.site_pages;

create policy "site_pages: anyone reads a published page" on public.site_pages
  for select to anon using (is_published);
create policy "site_pages: a member reads published pages, a website manager every page" on public.site_pages
  for select to authenticated using (is_published or (select private.may('site.edit')));
create policy "site_pages: a website manager adds a page" on public.site_pages
  for insert to authenticated with check ((select private.may('site.edit')));

-- Stamp who made the page and when: never what the browser sent.
create or replace function public.site_pages_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists site_pages_stamp on public.site_pages;
create trigger site_pages_stamp before insert on public.site_pages
  for each row execute function public.site_pages_stamp();

notify pgrst, 'reload schema';
