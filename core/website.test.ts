import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLES } from './members.ts';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';
import { MemorySitePageStore } from './memorySitePageStore.ts';
import {
  SITE_PAGE_NAME_MAX, SITE_PAGE_SLUG_MAX, addSitePage, changeSitePage, deleteSitePage, isSitePageSlug, mayManageWebsite, sitePageSlug, sortSitePages,
  type SitePageDeps,
} from './website.ts';

const TOOL = 'wavecenter';

function setup(): SitePageDeps & { pages: MemorySitePageStore; roles: MemoryMemberRoleStore } {
  const roles = new MemoryMemberRoleStore();
  roles.rows.set('dane', { role: 'admin', tool: 'migration' });
  roles.rows.set('eddie', { role: 'editor', tool: TOOL });
  roles.rows.set('vee', { role: 'viewer', tool: TOOL });
  return { pages: new MemorySitePageStore(), roles };
}

const refused = (p: Promise<unknown>) => p.then(() => 'saved', (e: Error) => e.message);

test('only an admin manages the website at the start; the database grants decide after that', () => {
  assert.deepEqual(ROLES.filter((r) => mayManageWebsite(r.key)).map((r) => r.key), ['admin']);
  assert.equal(mayManageWebsite(null), false);
  assert.equal(mayManageWebsite('editor', { editor: ['site.edit'] }), true);
  assert.equal(mayManageWebsite('admin', { admin: ['home.edit'] }), false);
});

test('the migration turns on row-level security and checks the same limits core does', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124120000_site_pages.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.site_pages/);
  assert.match(sql, /alter table public\.site_pages enable row level security/);
  assert.match(sql, new RegExp(`between 1 and ${SITE_PAGE_NAME_MAX}\\)`));
  assert.match(sql, new RegExp(`length\\(slug\\) <= ${SITE_PAGE_SLUG_MAX} and slug ~ '\\^\\[a-z0-9\\]\\+\\(-\\[a-z0-9\\]\\+\\)\\*\\$'`));
  assert.match(sql, /private\.may\('site\.edit'\)/);
  assert.match(sql, /is_published\s+boolean\s+not null default false/);
});

test('an address is made from a name: lower case, single hyphens, "page" when nothing is left', () => {
  assert.equal(sitePageSlug('About Us!'), 'about-us');
  assert.equal(sitePageSlug('  --The  DEO -- Whitepaper  '), 'the-deo-whitepaper');
  assert.equal(sitePageSlug('¿¡!'), 'page');
  assert.equal(sitePageSlug('a'.repeat(79) + ' b'), 'a'.repeat(79));
  for (const good of ['test', 'about-us', 'v2', 'a-1-b']) assert.equal(isSitePageSlug(good), true, good);
  for (const bad of ['', 'About', 'about us', '-about', 'about-', 'a--b', 'a/b', 'x'.repeat(81), null]) assert.equal(isSitePageSlug(bad), false, String(bad));
});

test('an admin makes a draft page with a name and an address, naming the tool', async () => {
  const deps = setup();
  const page = await addSitePage(deps, { actorId: 'dane', name: '  Test  ', slug: ' test ' }, TOOL);
  assert.equal(page.name, 'Test');
  assert.equal(page.slug, 'test');
  assert.equal(page.isPublished, false);
  assert.equal(page.tool, TOOL);
  assert.equal(deps.pages.rows.length, 1);
});

test('a blank address is made from the name, and a leading slash or capitals are forgiven', async () => {
  const deps = setup();
  assert.equal((await addSitePage(deps, { actorId: 'dane', name: 'Join the DEO' }, TOOL)).slug, 'join-the-deo');
  assert.equal((await addSitePage(deps, { actorId: 'dane', name: 'Contact', slug: '/Contact' }, TOOL)).slug, 'contact');
});

test('an address already used is refused in plain words, and nothing is saved', async () => {
  const deps = setup();
  await addSitePage(deps, { actorId: 'dane', name: 'Test', slug: 'test' }, TOOL);
  assert.equal(await refused(addSitePage(deps, { actorId: 'dane', name: 'Another', slug: 'test' }, TOOL)),
    'The address "test" is already used by the page "Test". Pick another address.');
  assert.equal(deps.pages.rows.length, 1);
});

test('a role without Manage website cannot make a page', async () => {
  const deps = setup();
  for (const who of ['eddie', 'vee']) {
    assert.match(await refused(addSitePage(deps, { actorId: who, name: 'Test', slug: 'test' }, TOOL)), /may not manage the website/);
  }
  assert.equal(deps.pages.rows.length, 0);
  deps.grants = { editor: ['site.edit'] };
  assert.equal((await addSitePage(deps, { actorId: 'eddie', name: 'Test' }, TOOL)).slug, 'test');
});

test('a blank or long name, a badly formed address and a missing tool are refused', async () => {
  const deps = setup();
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: ' \n ' }, TOOL)), /needs a name/);
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'x'.repeat(81) }, TOOL)), /at most 80 characters/);
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'Test', slug: 'about us' }, TOOL)), /"about us" cannot be a page's address/);
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'Test', slug: 'a--b' }, TOOL)), /cannot be a page's address/);
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'Test' }, ' ')), /must name the tool/);
  assert.equal(deps.pages.rows.length, 0);
});

test('a save that did not stick says so (rule 6)', async () => {
  const deps = setup();
  deps.pages.failNextSave = true;
  assert.equal(await refused(addSitePage(deps, { actorId: 'dane', name: 'Test' }, TOOL)), 'The page did not save. Nothing was made; try again.');
});

test('pages sort A to Z by name, ignoring capitals', () => {
  const at = '2026-11-23T00:00:00Z';
  const page = (name: string, slug: string) => ({ id: slug, name, slug, isPublished: false, createdBy: null, tool: TOOL, createdAt: at, updatedAt: at });
  assert.deepEqual(sortSitePages([page('beta', 'b'), page('Alpha', 'a2'), page('alpha', 'a1')]).map((p) => p.slug), ['a1', 'a2', 'b']);
});

// WC-207: changing, publishing and deleting a page.

async function withPages() {
  const deps = setup();
  const test1 = await addSitePage(deps, { actorId: 'dane', name: 'Test', slug: 'test' }, TOOL);
  const about = await addSitePage(deps, { actorId: 'dane', name: 'About us' }, TOOL);
  return { deps, test1, about };
}

test('the edit migration grants change and delete to a website manager only, and stamps the change time', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124130000_site_pages_edit.sql', import.meta.url), 'utf8');
  assert.match(sql, /grant update \(name, slug, is_published\) on public\.site_pages to authenticated/);
  assert.match(sql, /grant delete on public\.site_pages to authenticated/);
  assert.match(sql, /for update to authenticated\s+using \(\(select private\.may\('site\.edit'\)\)\)\s+with check \(\(select private\.may\('site\.edit'\)\)\)/);
  assert.match(sql, /for delete to authenticated using \(\(select private\.may\('site\.edit'\)\)\)/);
  assert.match(sql, /new\.updated_at := now\(\)/);
});

test('an admin renames a page and gives it a new address, read back', async () => {
  const { deps, test1 } = await withPages();
  const saved = await changeSitePage(deps, { actorId: 'dane', id: test1.id, name: '  Our   test ', slug: ' /Our-Test ' }, TOOL);
  assert.equal(saved.name, 'Our test');
  assert.equal(saved.slug, 'our-test');
  assert.equal(saved.isPublished, false);
  assert.equal(deps.pages.rows.find((p) => p.id === test1.id)?.slug, 'our-test');
});

test('a blank address keeps the page its own, and keeping the same address is not "taken"', async () => {
  const { deps, test1 } = await withPages();
  assert.equal((await changeSitePage(deps, { actorId: 'dane', id: test1.id, name: 'Renamed', slug: '  ' }, TOOL)).slug, 'test');
  assert.equal((await changeSitePage(deps, { actorId: 'dane', id: test1.id, slug: 'test' }, TOOL)).slug, 'test');
});

test('publishing a page and taking it back to a draft each save', async () => {
  const { deps, test1 } = await withPages();
  assert.equal((await changeSitePage(deps, { actorId: 'dane', id: test1.id, isPublished: true }, TOOL)).isPublished, true);
  assert.equal(deps.pages.rows.find((p) => p.id === test1.id)?.isPublished, true);
  assert.equal((await changeSitePage(deps, { actorId: 'dane', id: test1.id, isPublished: false }, TOOL)).isPublished, false);
});

test('an address another page uses is refused in plain words, and nothing changes', async () => {
  const { deps, test1 } = await withPages();
  assert.equal(await refused(changeSitePage(deps, { actorId: 'dane', id: test1.id, slug: 'about-us' }, TOOL)),
    'The address "about-us" is already used by the page "About us". Pick another address.');
  assert.equal(deps.pages.rows.find((p) => p.id === test1.id)?.slug, 'test');
});

test('a blank or long name, a badly formed address, a missing page or tool are refused when changing', async () => {
  const { deps, test1 } = await withPages();
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: test1.id, name: ' ' }, TOOL)), /needs a name/);
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: test1.id, name: 'x'.repeat(81) }, TOOL)), /at most 80 characters/);
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: test1.id, slug: 'a b' }, TOOL)), /"a b" cannot be a page's address/);
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: 'nope', name: 'X' }, TOOL)), /was not found/);
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: test1.id, name: 'X' }, '')), /must name the tool/);
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: test1.id, isPublished: 'yes' as unknown as boolean }, TOOL)), /published or a draft/);
  assert.equal(deps.pages.rows.find((p) => p.id === test1.id)?.name, 'Test');
});

test('a change that did not stick says so (rule 6)', async () => {
  const { deps, test1 } = await withPages();
  deps.pages.failNextSave = true;
  assert.equal(await refused(changeSitePage(deps, { actorId: 'dane', id: test1.id, isPublished: true }, TOOL)),
    'The change did not save. The page is as it was; try again.');
});

test('an admin deletes a page; a delete that did not stick says so; a page already gone says so', async () => {
  const { deps, test1, about } = await withPages();
  assert.equal((await deleteSitePage(deps, { actorId: 'dane', id: test1.id }, TOOL)).id, test1.id);
  assert.deepEqual(deps.pages.rows.map((p) => p.id), [about.id]);
  assert.match(await refused(deleteSitePage(deps, { actorId: 'dane', id: test1.id }, TOOL)), /already have been deleted/);
  deps.pages.failNextSave = true;
  assert.equal(await refused(deleteSitePage(deps, { actorId: 'dane', id: about.id }, TOOL)),
    'The page "About us" was not deleted. It is still there; try again.');
  assert.equal(deps.pages.rows.length, 1);
});

test('a role without Manage website cannot change, publish or delete a page', async () => {
  const { deps, test1 } = await withPages();
  for (const who of ['eddie', 'vee']) {
    assert.match(await refused(changeSitePage(deps, { actorId: who, id: test1.id, name: 'Mine' }, TOOL)), /may not manage the website.*change pages/);
    assert.match(await refused(changeSitePage(deps, { actorId: who, id: test1.id, isPublished: true }, TOOL)), /may not manage the website/);
    assert.match(await refused(deleteSitePage(deps, { actorId: who, id: test1.id }, TOOL)), /may not manage the website.*delete pages/);
  }
  assert.deepEqual(deps.pages.rows.find((p) => p.id === test1.id), test1);
  assert.equal(deps.pages.rows.length, 2);
});
