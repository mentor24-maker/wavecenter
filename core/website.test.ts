import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLES } from './members.ts';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';
import { MemorySitePageStore } from './memorySitePageStore.ts';
import {
  SITE_PAGE_NAME_MAX, SITE_PAGE_SLUG_MAX, SITE_SECTIONS_BYTES_MAX, SITE_SECTIONS_MAX, SITE_SECTION_LAYOUTS, SITE_SECTION_TITLE_MAX,
  addSitePage, changeSitePage, deleteSitePage, isSitePageSlug, jsonbText, mayManageWebsite, newSiteSection, normalizeSiteSections,
  saveSitePageSections, sitePageSlug, siteSectionCells, siteSectionChanges, siteSectionGrid, siteSectionsBytes, sortSitePages,
  type SitePageDeps,
} from './website.ts';

const TOOL = 'wavecenter';

function setup(ledger: MemoryEngagementStore | null = null): SitePageDeps & { pages: MemorySitePageStore; roles: MemoryMemberRoleStore } {
  const roles = new MemoryMemberRoleStore();
  roles.rows.set('dane', { role: 'admin', tool: 'migration' });
  roles.rows.set('eddie', { role: 'editor', tool: TOOL });
  roles.rows.set('vee', { role: 'viewer', tool: TOOL });
  return { pages: new MemorySitePageStore(ledger), roles };
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
  const page = (name: string, slug: string) => ({ id: slug, name, slug, isPublished: false, createdBy: null, tool: TOOL, createdAt: at, updatedAt: at, sections: [] });
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

const scored = (ledger: MemoryEngagementStore, kind: string) => ledger.rows.filter((e) => e.kind === kind).map((e) => [e.memberId, e.points, e.tool, e.taskId]);

test('making a page records one engagement for its maker, naming the tool; a refused or failed one, or a service-key one, records none', async () => {
  const ledger = new MemoryEngagementStore();
  const worth = (await ledger.rules()).find((r) => r.kind === 'made_a_page')!.points;
  assert.equal(worth, 1);
  const deps = setup(ledger);
  deps.pages.signedIn = 'dane';

  // Refused: by role, a blank name, a bad or taken address, a blank tool. Nothing is recorded.
  deps.pages.signedIn = 'vee';
  assert.match(await refused(addSitePage(deps, { actorId: 'vee', name: 'Viewer page' }, TOOL)), /may not manage the website/);
  deps.pages.signedIn = 'dane';
  await addSitePage(deps, { actorId: 'dane', name: 'First' }, 'page-tool');
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'Again', slug: 'first' }, TOOL)), /already used/);
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: '  ' }, TOOL)), /needs a name/);
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'Bad', slug: 'a b' }, TOOL)), /cannot be a page's address/);
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'No tool' }, ' ')), /tool/i);
  // The made one: one engagement for its maker, at the rule's points, naming the tool.
  assert.deepEqual(scored(ledger, 'made_a_page'), [['dane', worth, 'page-tool', null]]);

  // A save that did not stick records nothing.
  deps.pages.failNextSave = true;
  assert.match(await refused(addSitePage(deps, { actorId: 'dane', name: 'Lost' }, TOOL)), /did not save/);
  assert.equal(scored(ledger, 'made_a_page').length, 1);

  // If the engagement cannot be written, the page is not saved either.
  ledger.failInsert = true;
  await assert.rejects(addSitePage(deps, { actorId: 'dane', name: 'Unscored' }, TOOL), /ledger is down/);
  ledger.failInsert = false;
  assert.deepEqual(deps.pages.rows.map((p) => p.slug), ['first']);

  // A service-key write (nobody signed in) saves the page and scores nothing.
  deps.pages.signedIn = null;
  await addSitePage(deps, { actorId: 'dane', name: 'By key' }, TOOL);
  assert.equal(deps.pages.rows.length, 2);
  assert.equal(scored(ledger, 'made_a_page').length, 1);
});

test('publishing a draft page records one engagement for the member who published it, naming the tool; a rename, a refused or failed one, or a service-key one, records none', async () => {
  const ledger = new MemoryEngagementStore();
  const worth = (await ledger.rules()).find((r) => r.kind === 'published_a_page')!.points;
  assert.equal(worth, 1);
  const deps = setup(ledger);
  deps.pages.signedIn = 'dane';
  const page = await addSitePage(deps, { actorId: 'dane', name: 'About' }, TOOL);
  const published = () => scored(ledger, 'published_a_page');

  // A change that does not publish, or a refused one, records nothing.
  await changeSitePage(deps, { actorId: 'dane', id: page.id, name: 'About us' }, TOOL);
  await changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: false }, TOOL);
  assert.match(await refused(changeSitePage(deps, { actorId: 'vee', id: page.id, isPublished: true }, TOOL)), /may not manage the website/);
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: true }, ' ')), /tool/i);
  deps.pages.failNextSave = true;
  assert.match(await refused(changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: true }, TOOL)), /did not save/);
  assert.deepEqual(published(), []);

  // If the engagement cannot be written, the page stays a draft.
  ledger.failInsert = true;
  await assert.rejects(changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: true }, TOOL), /ledger is down/);
  ledger.failInsert = false;
  assert.equal(deps.pages.rows[0].isPublished, false);

  // Published: one engagement for the member who did it, naming the tool that published.
  await changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: true }, 'publish-tool');
  assert.deepEqual(published(), [['dane', worth, 'publish-tool', null]]);
  // Saving it published again, or renaming it, is not a second publish.
  await changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: true, name: 'About WaveCenter' }, TOOL);
  assert.equal(published().length, 1);

  // A service-key publish (nobody signed in) is saved and scores nothing.
  await changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: false }, TOOL);
  deps.pages.signedIn = null;
  await changeSitePage(deps, { actorId: 'dane', id: page.id, isPublished: true }, TOOL);
  assert.equal(deps.pages.rows[0].isPublished, true);
  assert.equal(published().length, 1);
});

test('the database scores making a page for its maker and publishing one for whoever published it, naming the tool', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124150000_score_made_a_page.sql', import.meta.url), 'utf8');
  assert.match(sql, /if new\.created_by is not null and new\.created_by = auth\.uid\(\) then\s+perform public\.record_engagement\(new\.created_by, 'made_a_page', new\.tool, null\);/);
  assert.match(sql, /create trigger site_pages_score_made\s+after insert on public\.site_pages/);
  assert.match(sql, /if v_member is not null then\s+perform public\.record_engagement\(v_member, 'published_a_page', public\.engagement_tool\(new\.tool\), null\);/);
  assert.match(sql, /create trigger site_pages_score_published\s+after update of is_published on public\.site_pages\s+for each row\s+when \(not old\.is_published and new\.is_published\)/);
  for (const fn of ['site_pages_score_made', 'site_pages_score_published']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated`), fn);
  }
  // The page's maker is stamped by the database: the browser cannot claim someone else's credit.
  const table = readFileSync(new URL('../supabase/migrations/20261124120000_site_pages.sql', import.meta.url), 'utf8');
  assert.match(table, /new\.created_by := auth\.uid\(\);/);
});

// WC-208: a page built from sections and layouts.

test('the sections migration lets a website manager change sections, under the limits core uses', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124140000_site_pages_sections.sql', import.meta.url), 'utf8');
  assert.match(sql, /grant update \(layout_sections\) on public\.site_pages to authenticated/);
  assert.match(sql, new RegExp(`jsonb_array_length\\(layout_sections\\) <= ${SITE_SECTIONS_MAX} and octet_length\\(layout_sections::text\\) <= ${SITE_SECTIONS_BYTES_MAX}\\)`));
});

test('every layout has its cells and grid, as in Normie', () => {
  assert.deepEqual(SITE_SECTION_LAYOUTS.map((l) => l.key), ['single', 'two-column', 'three-column', 'two-four', 'four-two', 'one-five', 'five-one']);
  assert.deepEqual(siteSectionCells('single'), ['main']);
  assert.deepEqual(siteSectionCells('three-column'), ['left', 'center', 'right']);
  assert.deepEqual(siteSectionCells('one-five'), ['left', 'right']);
  assert.equal(siteSectionGrid('four-two'), '4fr 2fr');
  assert.equal(siteSectionGrid('nope' as never), '1fr');
});

test('anything malformed in layout_sections is tidied into a well-formed list, never a crash', () => {
  for (const junk of [null, undefined, 3, true, {}, 'not json', '{"a":1}', [null, 4, 'x', [1]]]) {
    assert.deepEqual(normalizeSiteSections(junk), [], JSON.stringify(junk));
  }
  const tidy = normalizeSiteSections([
    { id: 'hero', title: '  Big   hello ', layout: 'three-column', alignment: 'center', marginTop: '24', marginBottom: 999, background: '#ABC' },
    { id: 'hero', layout: 'hero-split', alignment: 'sideways', marginTop: -5, marginBottom: 'lots', background: 'red' },
    { id: 'bad id!', title: 7, layout: 'five-one', background: { mode: 'color', color: '#00FF00' } },
    { background: { mode: 'gradient', color: '#00ff00' }, title: 'x'.repeat(200) },
  ]);
  assert.deepEqual(tidy, [
    { id: 'hero', title: 'Big hello', layout: 'three-column', alignment: 'center', marginTop: 24, marginBottom: 160, background: '#aabbcc' },
    { id: 'section-1', title: '', layout: 'single', alignment: 'left', marginTop: 0, marginBottom: 0, background: '' },
    { id: 'section-2', title: '', layout: 'five-one', alignment: 'left', marginTop: 0, marginBottom: 0, background: '#00ff00' },
    { id: 'section-3', title: 'x'.repeat(SITE_SECTION_TITLE_MAX), layout: 'single', alignment: 'left', marginTop: 0, marginBottom: 0, background: '' },
  ]);
  // A JSON string is read; a made-up id never takes one a later section already has.
  assert.deepEqual(normalizeSiteSections('[{"id":"x"},{},{"id":"section-1"}]').map((s) => s.id), ['x', 'section-2', 'section-1']);
  // Already tidy stays exactly as it is.
  assert.deepEqual(normalizeSiteSections(tidy), tidy);
});

test('a new section has its layout and an id no other section has', () => {
  const a = newSiteSection('two-column');
  assert.equal(a.layout, 'two-column');
  assert.match(a.id, /^section-[0-9a-f]{8}$/);
  assert.notEqual(newSiteSection('single', [a]).id, a.id);
  assert.deepEqual(normalizeSiteSections([a]), [a]);
});

test("the size is counted as Postgres writes jsonb's text", () => {
  // select '{"a":1,"b":[1,"é"],"c":{}}'::jsonb::text  →  {"a": 1, "b": [1, "é"], "c": {}}
  assert.equal(jsonbText({ a: 1, b: [1, 'é'], c: {} }), '{"a": 1, "b": [1, "é"], "c": {}}');
  assert.equal(jsonbText([]), '[]');
  assert.equal(siteSectionsBytes([]), 2);
  assert.equal(siteSectionsBytes(normalizeSiteSections([{ id: 's', title: 'é' }])),
    new TextEncoder().encode('[{"id": "s", "title": "é", "layout": "single", "alignment": "left", "marginTop": 0, "marginBottom": 0, "background": ""}]').length);
});

test('the unsaved changes are named in words', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((id) => normalizeSiteSections([{ id }])[0]);
  assert.deepEqual(siteSectionChanges([a, b], [a, b]), []);
  assert.deepEqual(siteSectionChanges([a, b], [b, a]), ['the order changed']);
  assert.deepEqual(siteSectionChanges([a, b], [a, b, c]), ['1 section added']);
  assert.deepEqual(siteSectionChanges([a, b, c], [c]), ['2 sections removed']);
  assert.deepEqual(siteSectionChanges([a, b], [{ ...b, layout: 'two-column' }, a, c]), ['1 section added', '1 section changed', 'the order changed']);
});

test('an admin adds three sections with different layouts, reorders them and saves; they read back as saved', async () => {
  const { deps, test1 } = await withPages();
  const one = newSiteSection('single');
  const two = newSiteSection('two-column', [one]);
  const three = newSiteSection('three-column', [one, two]);
  const order = [two, { ...one, title: 'Welcome', marginTop: 40, background: '#112233' }, three];
  const saved = await saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: order }, TOOL);
  assert.deepEqual(saved.sections, order);
  const reread = (await deps.pages.list()).find((p) => p.id === test1.id);
  assert.deepEqual(reread?.sections.map((s) => s.layout), ['two-column', 'single', 'three-column']);
  // Saving none clears them.
  assert.deepEqual((await saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: [] }, TOOL)).sections, []);
});

test('what is sent is tidied before it is saved', async () => {
  const { deps, test1 } = await withPages();
  const saved = await saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: [{ id: 'x', layout: 'sideways', marginTop: 500 }, 'junk'] }, TOOL);
  assert.deepEqual(saved.sections, [{ id: 'x', title: '', layout: 'single', alignment: 'left', marginTop: 160, marginBottom: 0, background: '' }]);
});

test('too many sections, too large, not a list, a missing page or tool, or the wrong role are refused; nothing changes', async () => {
  const { deps, test1 } = await withPages();
  const many = Array.from({ length: SITE_SECTIONS_MAX + 1 }, (_, i) => ({ id: `s${i}` }));
  assert.match(await refused(saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: many }, TOOL)), /at most 50 sections, and this one has 51/);
  assert.equal(await refused(saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: many.slice(0, SITE_SECTIONS_MAX) }, TOOL)), 'saved');
  assert.match(await refused(saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: '[]' }, TOOL)), /must be a list/);
  assert.match(await refused(saveSitePageSections(deps, { actorId: 'dane', id: 'nope', sections: [] }, TOOL)), /was not found/);
  assert.match(await refused(saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: [] }, ' ')), /must name the tool/);
  for (const who of ['eddie', 'vee']) {
    assert.match(await refused(saveSitePageSections(deps, { actorId: who, id: test1.id, sections: [] }, TOOL)), /may not manage the website.*build pages/);
  }
  assert.equal(deps.pages.rows.find((p) => p.id === test1.id)?.sections.length, SITE_SECTIONS_MAX);
  // The size limit, at the most sections a page holds: 50 sections with the longest titles still fit.
  const big = Array.from({ length: SITE_SECTIONS_MAX }, (_, i) => ({ ...newSiteSection('three-column'), id: `s${i}`, title: '€'.repeat(SITE_SECTION_TITLE_MAX) }));
  assert.ok(siteSectionsBytes(normalizeSiteSections(big)) < SITE_SECTIONS_BYTES_MAX);
});

test('a save of sections that did not stick says so, and the page keeps what it had (rule 6)', async () => {
  const { deps, test1 } = await withPages();
  deps.pages.failNextSave = true;
  assert.equal(await refused(saveSitePageSections(deps, { actorId: 'dane', id: test1.id, sections: [newSiteSection()] }, TOOL)),
    'The sections did not save. The page is as it was; try again.');
  assert.deepEqual(deps.pages.rows.find((p) => p.id === test1.id)?.sections, []);
});
