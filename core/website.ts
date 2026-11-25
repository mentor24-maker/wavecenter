/**
 * The website manager: WaveCenter's own page builder, reached from the Admin
 * page (Dane, 2026-11-22, WC-206: "WaveCenter needs it's own page builder
 * along the lines of Starcaster and Normie. Cannibalize both of those
 * repositories to develop a new and improved version for WaveCenter. Link to
 * it from the Admin page for now."). He chose "A" on the ticket: start from
 * Normie's leaner builder and bring in StarCaster's best parts one ticket at a
 * time. The plan is docs/WEBSITE_MANAGER.md.
 *
 * This first slice holds a page's record and who may make one; WC-207 adds
 * changing a page's name and address, publishing it or taking it back to a
 * draft, and deleting it, all under the same permission; WC-208 adds its
 * sections and their layouts (below). A page has a name, an address (its
 * slug: lower-case letters, digits and single hyphens) and its sections. A new page is a draft:
 * nobody outside the website managers sees it until it is published, which is
 * a later ticket.
 *
 * Who may manage the website is the role's `site.edit` permission
 * (core/members.ts), granted to admins at the start. The database's
 * row-level security repeats it (supabase/migrations/20261124120000_site_pages.sql),
 * so a client that went around core still cannot write a page.
 */
import { STARTING_ROLE_PERMISSIONS, mayDo, roleOf, type MemberRoleStore, type RoleKey } from './members.ts';
import { CoreError, requireTool } from './tool.ts';

/** The most a page's name and its address may hold. The migration checks the same. */
export const SITE_PAGE_NAME_MAX = 80;
export const SITE_PAGE_SLUG_MAX = 80;

/** A well-formed address: lower-case letters and digits in runs joined by single hyphens. The migration checks the same pattern. */
export const SITE_PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One page of the website, in core's own names. */
export interface SitePage {
  id: string;
  name: string;
  slug: string;
  isPublished: boolean;
  /** Null once the member who made it has left. */
  createdBy: string | null;
  /** The tool that made it. */
  tool: string;
  createdAt: string;
  updatedAt: string;
  /** The page's sections, top to bottom (WC-208), always well formed: read through `normalizeSiteSections`. */
  sections: SiteSection[];
}

/** What a change to a page may hold; what is not given stays as it is. */
export interface SitePagePatch {
  name?: string;
  slug?: string;
  isPublished?: boolean;
  /** The whole list of sections, replacing the saved one (WC-208). */
  sections?: SiteSection[];
}

/** What core needs from storage for the website's pages. */
export interface SitePageStore {
  /** Every page the caller may see. */
  list(): Promise<SitePage[]>;
  /** Save a new draft page. Returns what is now saved, or null if nothing was. */
  insert(row: { name: string; slug: string; tool: string }): Promise<SitePage | null>;
  /** Change a page's name, address or published state. Returns what is now saved, or null if no page changed. */
  update(id: string, patch: SitePagePatch): Promise<SitePage | null>;
  /** Delete a page. True only when a page was removed. */
  remove(id: string): Promise<boolean>;
}

/** What making a page needs: the pages, the actor's role, and the grants the database holds (the starting ones if not given). */
export interface SitePageDeps {
  pages: SitePageStore;
  roles: MemberRoleStore;
  grants?: Readonly<Record<string, readonly string[]>>;
}

/** May this role manage the website's pages? */
export function mayManageWebsite(
  role: RoleKey | null | undefined,
  grants: Readonly<Record<string, readonly string[]>> = STARTING_ROLE_PERMISSIONS,
): boolean {
  return mayDo(role, 'site.edit', grants);
}

/** The address a name suggests: lower case, every run of anything but a-z and 0-9 one hyphen, none at the ends; "page" if nothing is left. */
export function sitePageSlug(name: string): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SITE_PAGE_SLUG_MAX)
    .replace(/-+$/, '');
  return slug || 'page';
}

export function isSitePageSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SITE_PAGE_SLUG_MAX && SITE_PAGE_SLUG_PATTERN.test(value);
}

/** Pages A to Z by name, ignoring capitals; a tie by address. */
export function sortSitePages(pages: readonly SitePage[]): SitePage[] {
  return [...pages].sort((x, y) => x.name.localeCompare(y.name, 'en', { sensitivity: 'base' }) || x.slug.localeCompare(y.slug));
}

async function requireManager(deps: SitePageDeps, actorId: string, doing: string): Promise<void> {
  if (!mayManageWebsite(await roleOf(deps.roles, actorId), deps.grants)) {
    throw new CoreError(`Your role may not manage the website. Only a role with the Manage website permission can ${doing}.`);
  }
}

/** A page's name, tidied: trimmed, every run of white space one space. Throws when blank or too long. */
function cleanName(raw: string | undefined): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new CoreError('A page needs a name. Nothing was saved.');
  if (name.length > SITE_PAGE_NAME_MAX) throw new CoreError(`A page's name can be at most ${SITE_PAGE_NAME_MAX} characters.`);
  return name;
}

/** A typed address, trimmed and lower-cased with any leading slash dropped; blank gives `fallback`. Throws when badly formed. */
function cleanSlug(raw: string | undefined, fallback: string): string {
  const typed = (raw ?? '').trim().toLowerCase().replace(/^\/+/, '');
  const slug = typed || fallback;
  if (!isSitePageSlug(slug)) {
    throw new CoreError(
      `"${typed}" cannot be a page's address. Use lower-case letters and digits, with single hyphens between words (for example "about-us"), at most ${SITE_PAGE_SLUG_MAX} characters.`,
    );
  }
  return slug;
}

function refuseTakenSlug(pages: readonly SitePage[], slug: string, selfId?: string): void {
  const twin = pages.find((p) => p.slug === slug && p.id !== selfId);
  if (twin) throw new CoreError(`The address "${slug}" is already used by the page "${twin.name}". Pick another address.`);
}

/**
 * `actorId` makes a new draft page, on behalf of `tool`. The address is
 * trimmed and lower-cased; left blank, it is made from the name. Throws a
 * CoreError, in words for a person, when the role may not, the name or
 * address is not allowed, the address is taken, or the save did not stick.
 */
export async function addSitePage(
  deps: SitePageDeps,
  change: { actorId: string; name: string; slug?: string },
  tool: string,
): Promise<SitePage> {
  const named = requireTool(tool);
  await requireManager(deps, change.actorId, 'make pages');
  const name = cleanName(change.name);
  const slug = cleanSlug(change.slug, sitePageSlug(name));
  refuseTakenSlug(await deps.pages.list(), slug);
  const saved = await deps.pages.insert({ name, slug, tool: named });
  if (!saved || saved.slug !== slug || saved.name !== name) {
    throw new CoreError('The page did not save. Nothing was made; try again.');
  }
  return saved;
}

/**
 * `actorId` changes page `id` (WC-207): any of its name, its address, and
 * whether it is published. What is not given stays as it is; a blank address
 * keeps the page's own. The same rules as making a page apply, and the
 * address may not be one another page uses. Returns the page as now saved,
 * read back; throws a CoreError in plain words when the role may not, the
 * page is gone, a value is not allowed, or the save did not stick (rule 6).
 * `tool` is checked like every write's, though the page keeps the tool that
 * made it.
 */
export async function changeSitePage(
  deps: SitePageDeps,
  change: { actorId: string; id: string; name?: string; slug?: string; isPublished?: boolean },
  tool: string,
): Promise<SitePage> {
  requireTool(tool);
  await requireManager(deps, change.actorId, 'change pages');
  const pages = await deps.pages.list();
  const page = pages.find((p) => p.id === change.id);
  if (!page) throw new CoreError('This page was not found. It may have been deleted. Nothing was saved.');
  const patch: { name?: string; slug?: string; isPublished?: boolean } = {};
  if (change.name !== undefined) patch.name = cleanName(change.name);
  if (change.slug !== undefined) {
    patch.slug = cleanSlug(change.slug, page.slug);
    refuseTakenSlug(pages, patch.slug, page.id);
  }
  if (change.isPublished !== undefined) {
    if (typeof change.isPublished !== 'boolean') throw new CoreError('A page is either published or a draft. Nothing was saved.');
    patch.isPublished = change.isPublished;
  }
  if (Object.keys(patch).length === 0) return page;
  const saved = await deps.pages.update(page.id, patch);
  if (
    !saved ||
    saved.id !== page.id ||
    (patch.name !== undefined && saved.name !== patch.name) ||
    (patch.slug !== undefined && saved.slug !== patch.slug) ||
    (patch.isPublished !== undefined && saved.isPublished !== patch.isPublished)
  ) {
    throw new CoreError('The change did not save. The page is as it was; try again.');
  }
  return saved;
}

/**
 * `actorId` deletes page `id` (WC-207). Throws a CoreError in plain words
 * when the role may not, the page is already gone, or the delete did not
 * stick (rule 6). Returns the page that was deleted.
 */
export async function deleteSitePage(
  deps: SitePageDeps,
  change: { actorId: string; id: string },
  tool: string,
): Promise<SitePage> {
  requireTool(tool);
  await requireManager(deps, change.actorId, 'delete pages');
  const page = (await deps.pages.list()).find((p) => p.id === change.id);
  if (!page) throw new CoreError('This page was not found. It may already have been deleted.');
  if (!(await deps.pages.remove(page.id))) {
    throw new CoreError(`The page "${page.name}" was not deleted. It is still there; try again.`);
  }
  return page;
}

// ── Sections and layouts (WC-208) ─────────────────────────────────────────
//
// A page is a stack of sections, top to bottom. Each section has a layout
// (one, two or three columns, or one of Normie's uneven splits), and each
// column of that layout is a cell that modules will fill (WC-209). Ported
// from Normie's lib/builder-template.ts (`BuilderTemplateSection`,
// `getLayoutColumns`, `getLayoutGridTemplate`, `normalizeLayoutSections`),
// trimmed to the fields this step needs: an id, a title, the layout, the
// alignment, the spacing above and below, and one background colour.
//
// The sections are saved as JSON in `site_pages.layout_sections`. Whatever
// is stored there is read through `normalizeSiteSections`, so a malformed
// value is tidied into a well-formed list and never breaks a screen.

/** Every layout a section may have, in the order the editor offers them. */
export const SITE_SECTION_LAYOUTS = [
  { key: 'single', label: 'One column', cells: ['main'], grid: '1fr' },
  { key: 'two-column', label: 'Two columns, equal', cells: ['left', 'right'], grid: '1fr 1fr' },
  { key: 'three-column', label: 'Three columns, equal', cells: ['left', 'center', 'right'], grid: '1fr 1fr 1fr' },
  { key: 'two-four', label: 'Two columns, narrow then wide (1 : 2)', cells: ['left', 'right'], grid: '2fr 4fr' },
  { key: 'four-two', label: 'Two columns, wide then narrow (2 : 1)', cells: ['left', 'right'], grid: '4fr 2fr' },
  { key: 'one-five', label: 'Two columns, thin then wide (1 : 5)', cells: ['left', 'right'], grid: '1fr 5fr' },
  { key: 'five-one', label: 'Two columns, wide then thin (5 : 1)', cells: ['left', 'right'], grid: '5fr 1fr' },
] as const;

export type SiteSectionLayout = (typeof SITE_SECTION_LAYOUTS)[number]['key'];

export const SITE_SECTION_ALIGNMENTS = [
  { key: 'left', label: 'Left' },
  { key: 'center', label: 'Centre' },
  { key: 'right', label: 'Right' },
] as const;

export type SiteSectionAlignment = (typeof SITE_SECTION_ALIGNMENTS)[number]['key'];

/** The most a section's title may hold. */
export const SITE_SECTION_TITLE_MAX = 80;
/** The most space, in pixels, above or below a section (Normie's limit). */
export const SITE_SECTION_SPACING_MAX = 160;
/** The most sections one page may hold. The migration checks the same. */
export const SITE_SECTIONS_MAX = 50;
/** The most bytes a page's sections may take, measured as the database measures them. The migration checks the same. */
export const SITE_SECTIONS_BYTES_MAX = 200_000;

const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/** One section of a page, in core's own names. */
export interface SiteSection {
  /** Unique on its page; letters, digits, hyphens and underscores. */
  id: string;
  /** For the editor's own reference; may be blank. */
  title: string;
  layout: SiteSectionLayout;
  alignment: SiteSectionAlignment;
  /** Space above and below, whole pixels from 0 to SITE_SECTION_SPACING_MAX. */
  marginTop: number;
  marginBottom: number;
  /** A colour as "#rrggbb", or "" for none. */
  background: string;
}

/** The cells a layout has, left to right. */
export function siteSectionCells(layout: SiteSectionLayout): readonly string[] {
  return (SITE_SECTION_LAYOUTS.find((l) => l.key === layout) ?? SITE_SECTION_LAYOUTS[0]).cells;
}

/** The CSS grid columns a layout draws. */
export function siteSectionGrid(layout: SiteSectionLayout): string {
  return (SITE_SECTION_LAYOUTS.find((l) => l.key === layout) ?? SITE_SECTION_LAYOUTS[0]).grid;
}

function isLayout(value: unknown): value is SiteSectionLayout {
  return SITE_SECTION_LAYOUTS.some((l) => l.key === value);
}

function isAlignment(value: unknown): value is SiteSectionAlignment {
  return SITE_SECTION_ALIGNMENTS.some((a) => a.key === value);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max).trim() : '';
}

/** Whole pixels from 0 to the limit; a number or a numeric string; anything else is 0. */
function spacing(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n), 0), SITE_SECTION_SPACING_MAX);
}

/** "#rrggbb" lower case, from "#rgb" or "#rrggbb" or Normie's `{ mode: 'color', color }`; anything else is none. */
function colour(value: unknown): string {
  let raw = value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const bg = raw as Record<string, unknown>;
    raw = bg.mode === undefined || bg.mode === 'color' ? bg.color : '';
  }
  if (typeof raw !== 'string') return '';
  let hex = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return HEX_COLOUR.test(hex) ? hex : '';
}

/**
 * Whatever is stored as a page's sections, as a well-formed list: never
 * throws. A JSON string is read; anything but a list is no sections; an entry
 * that is not an object is dropped; every field is checked and anything
 * missing or not allowed takes its plain default (one column, left, no
 * spacing, no colour). An id that is missing, badly formed or used twice is
 * replaced with one of the form "section-<n>", unique on the page.
 */
export function normalizeSiteSections(value: unknown): SiteSection[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const entries = raw.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object' && !Array.isArray(s));
  const taken = new Set<string>();
  const kept = entries.map((s) => (typeof s.id === 'string' && SECTION_ID.test(s.id) && !taken.has(s.id) ? (taken.add(s.id), s.id) : null));
  let n = 0;
  return entries.map((s, i) => {
    let id = kept[i];
    if (id === null) {
      do id = `section-${++n}`; while (taken.has(id));
      taken.add(id);
    }
    return {
      id,
      title: text(s.title, SITE_SECTION_TITLE_MAX),
      layout: isLayout(s.layout) ? s.layout : 'single',
      alignment: isAlignment(s.alignment) ? s.alignment : 'left',
      marginTop: spacing(s.marginTop),
      marginBottom: spacing(s.marginBottom),
      background: colour(s.background),
    };
  });
}

/** A fresh section id, unlike any in `existing`. */
export function newSiteSectionId(existing: readonly { id: string }[] = []): string {
  const taken = new Set(existing.map((s) => s.id));
  for (;;) {
    const id = `section-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
}

/** A new, empty section of `layout`, with an id unlike any in `existing`. */
export function newSiteSection(layout: SiteSectionLayout = 'single', existing: readonly { id: string }[] = []): SiteSection {
  return { id: newSiteSectionId(existing), title: '', layout: isLayout(layout) ? layout : 'single', alignment: 'left', marginTop: 0, marginBottom: 0, background: '' };
}

/**
 * The text Postgres gives for this value as `jsonb` (`layout_sections::text`):
 * JSON with a space after every ":" and ",". Its length in bytes is what
 * the migration's size limit measures, so core and the database count the same.
 */
export function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${jsonbText(v)}`).join(', ')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** How many bytes these sections take in the database. */
export function siteSectionsBytes(sections: readonly SiteSection[]): number {
  return new TextEncoder().encode(jsonbText(sections)).length;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The unsaved changes between the saved sections and the ones on screen, in
 * words, for the editor to name before anyone leaves ("2 sections added",
 * "the order changed"). Empty when there is nothing unsaved.
 */
export function siteSectionChanges(saved: readonly SiteSection[], now: readonly SiteSection[]): string[] {
  const before = new Map(saved.map((s) => [s.id, s]));
  const after = new Set(now.map((s) => s.id));
  const added = now.filter((s) => !before.has(s.id)).length;
  const removed = saved.filter((s) => !after.has(s.id)).length;
  const changed = now.filter((s) => before.has(s.id) && JSON.stringify(s) !== JSON.stringify(before.get(s.id))).length;
  const stayedBefore = saved.filter((s) => after.has(s.id)).map((s) => s.id);
  const stayedNow = now.filter((s) => before.has(s.id)).map((s) => s.id);
  const out: string[] = [];
  if (added) out.push(`${plural(added, 'section')} added`);
  if (removed) out.push(`${plural(removed, 'section')} removed`);
  if (changed) out.push(`${plural(changed, 'section')} changed`);
  if (stayedBefore.join('\n') !== stayedNow.join('\n')) out.push('the order changed');
  return out;
}

/**
 * `actorId` saves page `id`'s sections (WC-208): the whole list, top to
 * bottom, replacing what was saved. What is sent is tidied through
 * `normalizeSiteSections` (it must be a list); more than SITE_SECTIONS_MAX
 * sections, or more than SITE_SECTIONS_BYTES_MAX bytes, is refused. Returns
 * the page as now saved, read back and compared; throws a CoreError in plain
 * words when the role may not, the page is gone, the list is not allowed,
 * or the save did not stick (rule 6).
 */
export async function saveSitePageSections(
  deps: SitePageDeps,
  change: { actorId: string; id: string; sections: unknown },
  tool: string,
): Promise<SitePage> {
  requireTool(tool);
  await requireManager(deps, change.actorId, 'build pages');
  if (!Array.isArray(change.sections)) throw new CoreError("A page's sections must be a list. Nothing was saved.");
  const sections = normalizeSiteSections(change.sections);
  if (sections.length > SITE_SECTIONS_MAX) {
    throw new CoreError(`A page can hold at most ${SITE_SECTIONS_MAX} sections, and this one has ${sections.length}. Remove some, then save. Nothing was saved.`);
  }
  if (siteSectionsBytes(sections) > SITE_SECTIONS_BYTES_MAX) {
    throw new CoreError('These sections are too large to save as one page. Remove some, then save. Nothing was saved.');
  }
  const page = (await deps.pages.list()).find((p) => p.id === change.id);
  if (!page) throw new CoreError('This page was not found. It may have been deleted. Nothing was saved.');
  const saved = await deps.pages.update(page.id, { sections });
  if (!saved || saved.id !== page.id || JSON.stringify(saved.sections) !== JSON.stringify(sections)) {
    throw new CoreError('The sections did not save. The page is as it was; try again.');
  }
  return saved;
}
