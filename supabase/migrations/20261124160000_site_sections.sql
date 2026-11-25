-- Saved sections, reused on many pages of the website (WC-212; the plan is
-- docs/WEBSITE_MANAGER.md). Save a section once (a header, a footer, a
-- banner) and reuse it on many pages; changing the saved one changes every
-- page that follows it. From StarCaster's saved sections, kept to its
-- lesson: one flag, one meaning.
--
--   site_sections   one saved section, the original: a name and one
--                   section's content as JSON, in core's shape
--                   (core/website.ts, normalizeSavedSectionContent)
--
-- A page holds an instance in its own `layout_sections` list: a section
-- whose `savedSectionId` names the original here, and whose `linked` flag
-- says whether it follows it (true) or is a plain copy (false). Nothing in
-- site_pages changes: core reads every linked instance through the original
-- when a page is shown (resolveSiteSections).
--
-- Who may see an original: a role with the Manage website permission
-- (site.edit) sees every one; anyone else, signed in or not, sees only one
-- that a page they can see follows, which for them is a published page.
-- Who may save or change one: a role with site.edit. Deleting an original
-- is not offered yet (a non-goal of WC-212), so it is not granted. The rules
-- live in core/website.ts; the database repeats them so a client that went
-- around core still cannot break them. A test keeps the limits here in step
-- with core's (core/website.test.ts):
--
--   a name of 1 to 80 characters             (SITE_SAVED_SECTION_NAME_MAX)
--   at most 50000 bytes as the column's text (SITE_SAVED_SECTION_BYTES_MAX)
--
-- Additive only. Safe to re-run: every statement checks before it creates.

create table if not exists public.site_sections (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (length(btrim(name, E' \t\n\r\f\x0B')) between 1 and 80),
  -- One section's content, in core's shape. Whatever is stored is tidied
  -- when it is read, so the database only keeps it one object, of a size.
  section     jsonb       not null default '{}'::jsonb
              check (jsonb_typeof(section) = 'object' and octet_length(section::text) <= 50000),
  -- Who saved it; stamped by the database. Deleting their account keeps it.
  created_by  uuid        references auth.users (id) on delete set null,
  tool        text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights at all and grant only what is used.
alter table public.site_sections enable row level security;

revoke all on public.site_sections from anon, authenticated;
grant select on public.site_sections to anon, authenticated;
-- The name, the content and the tool are the caller's to give; who and when
-- are the database's. A change is to the content only.
grant insert (name, section, tool) on public.site_sections to authenticated;
grant update (section) on public.site_sections to authenticated;

drop policy if exists "site_sections: anyone reads one a published page follows"                    on public.site_sections;
drop policy if exists "site_sections: a member reads one a page they see follows, a website manager every one" on public.site_sections;
drop policy if exists "site_sections: a website manager saves one"                                  on public.site_sections;
drop policy if exists "site_sections: a website manager changes one"                                on public.site_sections;

-- "A page follows it": the page's list holds a section naming this one with
-- linked true. The page is read under its own row-level security, so a
-- visitor counts only published pages.
create policy "site_sections: anyone reads one a published page follows" on public.site_sections
  for select to anon using (
    exists (
      select 1 from public.site_pages p
      where p.is_published
        and p.layout_sections @> jsonb_build_array(jsonb_build_object('savedSectionId', site_sections.id::text, 'linked', true))
    )
  );
create policy "site_sections: a member reads one a page they see follows, a website manager every one" on public.site_sections
  for select to authenticated using (
    (select private.may('site.edit'))
    or exists (
      select 1 from public.site_pages p
      where p.is_published
        and p.layout_sections @> jsonb_build_array(jsonb_build_object('savedSectionId', site_sections.id::text, 'linked', true))
    )
  );
create policy "site_sections: a website manager saves one" on public.site_sections
  for insert to authenticated with check ((select private.may('site.edit')));
create policy "site_sections: a website manager changes one" on public.site_sections
  for update to authenticated
  using ((select private.may('site.edit')))
  with check ((select private.may('site.edit')));

-- Stamp who saved it and when: never what the browser sent.
create or replace function public.site_sections_stamp()
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

-- Stamp when it last changed. Who and when it was made are kept by the
-- column grants, not here (copying old.created_by back would undo "on delete
-- set null").
create or replace function public.site_sections_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists site_sections_stamp on public.site_sections;
create trigger site_sections_stamp before insert on public.site_sections
  for each row execute function public.site_sections_stamp();
drop trigger if exists site_sections_touch on public.site_sections;
create trigger site_sections_touch before update on public.site_sections
  for each row execute function public.site_sections_touch();

notify pgrst, 'reload schema';
