-- Making a page and publishing a page earn their granular points (WC-213;
-- the website manager's plan is docs/WEBSITE_MANAGER.md). Two new actions
-- go on Game > Manage, each worth 1 point to start, with their four factors
-- left blank for an admin to score there:
--
--   made_a_page       Made a page       a new page of the website is saved
--   published_a_page  Published a page  a draft page is made public
--
-- Each is recorded inside the same save as the page, through the ledger's
-- own write function (public.record_engagement), so if the engagement
-- cannot be written the page is not saved either: one transaction. A write
-- the database refused (row-level security, a taken address) saves nothing,
-- so it fires nothing and earns nothing.
--
-- Who is credited:
--   - Making a page credits its maker: created_by, which site_pages_stamp
--     sets to auth.uid(). A service-key insert (nobody signed in) leaves it
--     null and is saved unscored, rather than failing the save.
--   - Publishing credits the member signed in (auth.uid()); the page has no
--     "published by" column. A service-key publish is saved unscored.
--     Publishing fires only on a change from draft to published, so a save
--     that leaves a page published (a rename) earns nothing; taking a page
--     back to a draft and publishing it again does publish it again.
--
-- The tool: a new page names its own (new.tool). A publish is made by
-- whichever tool sent the change, so it comes from the request's
-- x-wavecenter-tool header (app/lib/sitePageStore.ts sends it), falling back
-- to the page's tool, as the other change triggers do.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

insert into public.game_scoring_rules (kind, name, description, criteria, points, position)
select v.kind, v.name, v.description, v.criteria, v.points,
       (select coalesce(max(r.position), 0) from public.game_scoring_rules r) + v.ord
  from (values
  ('made_a_page', 'Made a page', 'Made a new page of the website on the Admin page''s website manager.', 'A new page is saved.', 1, 1),
  ('published_a_page', 'Published a page', 'Made a draft page of the website public.', 'A draft page is published.', 1, 2)
  ) as v (kind, name, description, criteria, points, ord)
on conflict (kind) do nothing;

create or replace function public.site_pages_score_made()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null and new.created_by = auth.uid() then
    perform public.record_engagement(new.created_by, 'made_a_page', new.tool, null);
  end if;
  return null;
end;
$$;

revoke execute on function public.site_pages_score_made() from public, anon, authenticated;

drop trigger if exists site_pages_score_made on public.site_pages;
create trigger site_pages_score_made
  after insert on public.site_pages
  for each row execute function public.site_pages_score_made();

create or replace function public.site_pages_score_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null then
    perform public.record_engagement(v_member, 'published_a_page', public.engagement_tool(new.tool), null);
  end if;
  return null;
end;
$$;

revoke execute on function public.site_pages_score_published() from public, anon, authenticated;

drop trigger if exists site_pages_score_published on public.site_pages;
create trigger site_pages_score_published
  after update of is_published on public.site_pages
  for each row
  when (not old.is_published and new.is_published)
  execute function public.site_pages_score_published();

notify pgrst, 'reload schema';
