-- Building a page of the website from sections and layouts (WC-208; the plan
-- is docs/WEBSITE_MANAGER.md). 20261124120000_site_pages.sql made the
-- `layout_sections` column, empty for every page; 20261124130000_site_pages_edit.sql
-- granted changing a page's name, address and published state. This grants
-- changing its sections too, to the same people: a role with the Manage
-- website permission (site.edit, admin only to start). The update policy
-- from 20261124130000 already holds them to that.
--
-- The shape of a section is core's (core/website.ts, normalizeSiteSections):
-- whatever is stored is tidied when it is read, so the database only keeps
-- the column a list, as it already did, and holds its size under two limits
-- core shares (a test keeps them in step, core/website.test.ts):
--
--   at most 50 sections on one page        (SITE_SECTIONS_MAX)
--   at most 200000 bytes as the column's text (SITE_SECTIONS_BYTES_MAX)
--
-- A change stamps updated_at (the trigger from 20261124130000).
--
-- Additive only. Every page today has an empty list, so the new check holds
-- for every row. Safe to re-run: every statement checks before it creates.

grant update (layout_sections) on public.site_pages to authenticated;

alter table public.site_pages drop constraint if exists site_pages_layout_sections_size;
alter table public.site_pages add constraint site_pages_layout_sections_size
  check (jsonb_array_length(layout_sections) <= 50 and octet_length(layout_sections::text) <= 200000);

notify pgrst, 'reload schema';
