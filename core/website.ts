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
import { safeHref } from './richText.ts';
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
  /** Change a page's name, address, published state or sections, on behalf of `tool`. Returns what is now saved, or null if no page changed. */
  update(id: string, patch: SitePagePatch, tool: string): Promise<SitePage | null>;
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
 * The database credits "Made a page" to the maker, naming `tool` (WC-213).
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
 * made it; publishing a draft earns "Published a page" naming `tool` (WC-213).
 */
export async function changeSitePage(
  deps: SitePageDeps,
  change: { actorId: string; id: string; name?: string; slug?: string; isPublished?: boolean },
  tool: string,
): Promise<SitePage> {
  const named = requireTool(tool);
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
  const saved = await deps.pages.update(page.id, patch, named);
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
  /** Not drawn at phone widths (WC-211, Normie's `mobileHidden`). */
  hideOnPhone: boolean;
  /** Not drawn at desktop widths (WC-211, Normie's `desktopHidden`). */
  hideOnDesktop: boolean;
  /** At phone widths its columns stack one above another (WC-211); off, they stay side by side. On by default. */
  stackOnPhone: boolean;
  /**
   * The saved section this one came from (WC-212), when it came from one:
   * kept when it is unlinked, and even when the original is gone. Never set
   * without `linked`.
   */
  savedSectionId?: string;
  /**
   * The one flag with the one meaning (StarCaster's lesson,
   * docs/SAVED_SECTIONS.md): true, this section follows its saved original,
   * shows the original's content wherever it is read, and cannot be edited
   * in place; false, it is a plain copy. Only ever set beside `savedSectionId`.
   */
  linked?: boolean;
  /** What fills the section's cells (WC-209), in order; each names its cell. Always well formed: read through `normalizeSiteModules`. */
  modules: SiteModule[];
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
 * spacing, no colour, no link, shown on every screen, columns stacking on a
 * phone). An id that is missing, badly formed or used twice is
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
  const moduleIds = new Set<string>();
  return entries.map((s, i) => {
    let id = kept[i];
    if (id === null) {
      do id = `section-${++n}`; while (taken.has(id));
      taken.add(id);
    }
    const section: SiteSection = {
      id,
      title: text(s.title, SITE_SECTION_TITLE_MAX),
      layout: isLayout(s.layout) ? s.layout : 'single',
      alignment: isAlignment(s.alignment) ? s.alignment : 'left',
      marginTop: spacing(s.marginTop),
      marginBottom: spacing(s.marginBottom),
      background: colour(s.background),
      hideOnPhone: s.hideOnPhone === true,
      hideOnDesktop: s.hideOnDesktop === true,
      stackOnPhone: s.stackOnPhone !== false,
      modules: normalizeSiteModules(s.modules, isLayout(s.layout) ? s.layout : 'single', moduleIds),
    };
    // A link names its original by id (WC-212); a malformed id is no link at all.
    const origin = typeof s.savedSectionId === 'string' ? s.savedSectionId.trim().toLowerCase() : '';
    if (UUID.test(origin)) {
      section.savedSectionId = origin;
      section.linked = s.linked === true;
    }
    return section;
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
  return { id: newSiteSectionId(existing), title: '', layout: isLayout(layout) ? layout : 'single', alignment: 'left', marginTop: 0, marginBottom: 0, background: '',
    hideOnPhone: false, hideOnDesktop: false, stackOnPhone: true, modules: [] };
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
  const named = requireTool(tool);
  await requireManager(deps, change.actorId, 'build pages');
  if (!Array.isArray(change.sections)) throw new CoreError("A page's sections must be a list. Nothing was saved.");
  const problem = siteModulesProblem(change.sections);
  if (problem) throw new CoreError(`${problem} Nothing was saved.`);
  const sections = normalizeSiteSections(change.sections);
  if (sections.length > SITE_SECTIONS_MAX) {
    throw new CoreError(`A page can hold at most ${SITE_SECTIONS_MAX} sections, and this one has ${sections.length}. Remove some, then save. Nothing was saved.`);
  }
  if (siteSectionsBytes(sections) > SITE_SECTIONS_BYTES_MAX) {
    throw new CoreError('These sections are too large to save as one page. Remove some, then save. Nothing was saved.');
  }
  const page = (await deps.pages.list()).find((p) => p.id === change.id);
  if (!page) throw new CoreError('This page was not found. It may have been deleted. Nothing was saved.');
  const saved = await deps.pages.update(page.id, { sections }, named);
  if (!saved || saved.id !== page.id || JSON.stringify(saved.sections) !== JSON.stringify(sections)) {
    throw new CoreError('The sections did not save. The page is as it was; try again.');
  }
  return saved;
}


// ── Saved sections, reused on many pages (WC-212) ─────────────────────────
//
// Save a section once (a header, a footer, a banner) and reuse it on many
// pages. The stored copy is the **original**, one row of `site_sections`;
// what sits on a page is an **instance**, a section in the page's list with
// `savedSectionId` naming its original. From StarCaster's saved sections
// (docs/SAVED_SECTIONS.md there), kept to its lesson: one flag, one meaning.
// `linked: true` means the instance follows its original and nothing else;
// `linked: false` is a plain copy, which still remembers where it came from.
//
// A linked instance's own content is only a fallback for when its original
// cannot be read (deleted, or hidden from a visitor): wherever a page is
// shown, its sections are read through `resolveSiteSections`, which puts the
// original's current content in place of every linked one. So changing the
// original changes every page that follows it, with no page rewritten.

/** The most a saved section's name may hold. The migration checks the same. */
export const SITE_SAVED_SECTION_NAME_MAX = 80;
/** The most bytes one saved section's content may take, measured as the database measures it. The migration checks the same. */
export const SITE_SAVED_SECTION_BYTES_MAX = 50_000;

/** One saved section, the original, in core's own names. */
export interface SiteSavedSection {
  id: string;
  name: string;
  /** Its content, well formed: read through `normalizeSavedSectionContent`. Never linked to anything itself. */
  section: SiteSection;
  /** Null once the member who saved it has left. */
  createdBy: string | null;
  tool: string;
  createdAt: string;
  updatedAt: string;
}

/** What core needs from storage for the saved sections. */
export interface SiteSavedSectionStore {
  /** Every saved section the caller may see. */
  list(): Promise<SiteSavedSection[]>;
  /** Save a new original. Returns what is now saved, or null if nothing was. */
  insert(row: { name: string; section: SiteSection; tool: string }): Promise<SiteSavedSection | null>;
  /** Change an original's content. Returns what is now saved, or null if nothing changed. */
  update(id: string, patch: { section: SiteSection }, tool: string): Promise<SiteSavedSection | null>;
  /** Give an original a new name (WC-246). Returns what is now saved, or null if nothing changed. */
  rename(id: string, name: string, tool: string): Promise<SiteSavedSection | null>;
  /** Delete an original (WC-246). True only when one was removed. */
  remove(id: string): Promise<boolean>;
}

/** What working with saved sections needs: the saved sections, the actor's role, and the grants. */
export interface SiteSavedSectionDeps {
  savedSections: SiteSavedSectionStore;
  roles: MemberRoleStore;
  grants?: Readonly<Record<string, readonly string[]>>;
}

/** What deleting a saved section needs besides: the pages, to turn every page that follows it into a plain copy first (WC-246). */
export interface SiteSavedSectionDeleteDeps extends SiteSavedSectionDeps {
  pages: SitePageStore;
}

/** A section's content as an original holds it: well formed, its id "section", no link of its own. Never throws. */
export function normalizeSavedSectionContent(value: unknown): SiteSection {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const [section] = normalizeSiteSections([raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}]);
  const { savedSectionId: _origin, linked: _linked, ...content } = section;
  return { ...content, id: 'section' };
}

/** Saved sections A to Z by name, ignoring capitals. */
export function sortSavedSections(saved: readonly SiteSavedSection[]): SiteSavedSection[] {
  return [...saved].sort((x, y) => x.name.localeCompare(y.name, 'en', { sensitivity: 'base' }) || x.id.localeCompare(y.id));
}

/** `instance` with `original`'s content: its own id and link kept, everything else the original's. */
function following(instance: SiteSection, original: SiteSavedSection): SiteSection {
  return { ...original.section, id: instance.id, savedSectionId: original.id, linked: true };
}

/**
 * A page's sections as they are shown: every linked section carries its
 * original's current content in place of its own. A linked section whose
 * original is not among `saved` (deleted, or not readable by this caller)
 * keeps the content it was last saved with. Plain sections and plain
 * copies are as stored.
 */
export function resolveSiteSections(sections: readonly SiteSection[], saved: readonly SiteSavedSection[]): SiteSection[] {
  const byId = new Map(saved.map((s) => [s.id, s]));
  return sections.map((s) => {
    const original = s.linked && s.savedSectionId ? byId.get(s.savedSectionId) : undefined;
    return original ? following(s, original) : s;
  });
}

/**
 * A new instance of `original` for a page, with a section id unlike any in
 * `existing`, and module ids unlike any on the page (WC-209: a module id is
 * unique on its page, so two copies of one original never share one):
 * linked (follows it) or a plain copy.
 */
export function insertSavedSection(
  original: SiteSavedSection,
  linked: boolean,
  existing: readonly { id: string; modules?: readonly { id: string }[] }[] = [],
): SiteSection {
  const onPage = existing.map((s) => ({ modules: [...(s.modules ?? [])] }));
  const modules = original.section.modules.map((m) => {
    const fresh = { ...m, id: newSiteModuleId(onPage) };
    onPage.push({ modules: [fresh] });
    return fresh;
  });
  return { ...original.section, id: newSiteSectionId(existing), modules, savedSectionId: original.id, linked: linked === true };
}

/** A linked section turned into a plain copy: its current content kept, still remembering its original, editable again. */
export function unlinkSiteSection(section: SiteSection): SiteSection {
  return section.savedSectionId ? { ...section, linked: false } : section;
}

/** Is this section locked to its original (so not editable in place)? */
export function isLinkedSiteSection(section: SiteSection): boolean {
  return section.linked === true && Boolean(section.savedSectionId);
}

/** How many pages, of `pages`, follow saved section `id` (a page counted once however many times it holds it). */
export function pagesFollowing(pages: readonly SitePage[], id: string): SitePage[] {
  return pages.filter((p) => p.sections.some((s) => s.linked === true && s.savedSectionId === id));
}

/** A saved section's name, tidied: trimmed, every run of white space one space. Throws when blank, too long, or another of `saved` already has it (ignoring capitals). */
function cleanSavedName(raw: string | undefined, saved: readonly SiteSavedSection[]): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new CoreError('A saved section needs a name, so it can be found again. Nothing was saved.');
  if (name.length > SITE_SAVED_SECTION_NAME_MAX) throw new CoreError(`A saved section's name can be at most ${SITE_SAVED_SECTION_NAME_MAX} characters. Nothing was saved.`);
  const twin = saved.find((s) => s.name.localeCompare(name, 'en', { sensitivity: 'base' }) === 0);
  if (twin) throw new CoreError(`There is already a saved section called "${twin.name}". Pick another name. Nothing was saved.`);
  return name;
}

function cleanContent(section: unknown): SiteSection {
  if (!section || typeof section !== 'object' || Array.isArray(section)) throw new CoreError('Only a section can be saved as a reusable section. Nothing was saved.');
  // A module the tidy-up would silently clear is refused in words, as a page's save does (WC-209).
  const problem = siteModulesProblem([section])?.replace(/^Section 1, /, '');
  if (problem) throw new CoreError(`${problem.charAt(0).toUpperCase()}${problem.slice(1)} Nothing was saved.`);
  const content = normalizeSavedSectionContent(section);
  if (new TextEncoder().encode(jsonbText(content)).length > SITE_SAVED_SECTION_BYTES_MAX) {
    throw new CoreError('This section is too large to save as a reusable section. Nothing was saved.');
  }
  return content;
}

async function requireSavedManager(deps: SiteSavedSectionDeps, actorId: string, doing: string): Promise<void> {
  if (!mayManageWebsite(await roleOf(deps.roles, actorId), deps.grants)) {
    throw new CoreError(`Your role may not manage the website. Only a role with the Manage website permission can ${doing}.`);
  }
}

/**
 * `actorId` saves `section` as a reusable section called `name` (WC-212),
 * on behalf of `tool`. Its content is tidied and stored without any link of
 * its own. Throws a CoreError in plain words when the role may not, the name
 * is blank, too long or taken, the section is too large, or the save did not
 * stick (rule 6). Returns the original as now saved, read back.
 */
export async function saveReusableSection(
  deps: SiteSavedSectionDeps,
  change: { actorId: string; name: string; section: unknown },
  tool: string,
): Promise<SiteSavedSection> {
  const named = requireTool(tool);
  await requireSavedManager(deps, change.actorId, 'save reusable sections');
  const name = cleanSavedName(change.name, await deps.savedSections.list());
  const section = cleanContent(change.section);
  const saved = await deps.savedSections.insert({ name, section, tool: named });
  if (!saved || saved.name !== name || JSON.stringify(saved.section) !== JSON.stringify(section)) {
    throw new CoreError('The reusable section did not save. Nothing was made; try again.');
  }
  return saved;
}

/**
 * `actorId` changes saved section `id`'s content to `section` (WC-212):
 * every page that follows it shows the change. Throws a CoreError in plain
 * words when the role may not, the original is gone, the section is too
 * large, or the save did not stick (rule 6). Returns the original as now
 * saved, read back.
 */
export async function changeSavedSection(
  deps: SiteSavedSectionDeps,
  change: { actorId: string; id: string; section: unknown },
  tool: string,
): Promise<SiteSavedSection> {
  const named = requireTool(tool);
  await requireSavedManager(deps, change.actorId, 'change saved sections');
  const original = (await deps.savedSections.list()).find((s) => s.id === change.id);
  if (!original) throw new CoreError('This saved section was not found. It may have been deleted. Nothing was saved.');
  const section = cleanContent(change.section);
  const saved = await deps.savedSections.update(original.id, { section }, named);
  if (!saved || saved.id !== original.id || JSON.stringify(saved.section) !== JSON.stringify(section)) {
    throw new CoreError(`The change to "${original.name}" did not save. Every page still shows it as it was; try again.`);
  }
  return saved;
}

/**
 * `actorId` gives saved section `id` a new name (WC-246), on behalf of
 * `tool`. The name is tidied and checked as a new one is: not blank, at most
 * SITE_SAVED_SECTION_NAME_MAX characters, and not another saved section's
 * name, ignoring capitals (its own, in other capitals, is allowed). Throws a
 * CoreError in plain words when the role may not, the original is gone, the
 * name is not allowed, or the save did not stick (rule 6). Returns the
 * original as now saved, read back.
 */
export async function renameSavedSection(
  deps: SiteSavedSectionDeps,
  change: { actorId: string; id: string; name: string },
  tool: string,
): Promise<SiteSavedSection> {
  const named = requireTool(tool);
  await requireSavedManager(deps, change.actorId, 'rename saved sections');
  const all = await deps.savedSections.list();
  const original = all.find((s) => s.id === change.id);
  if (!original) throw new CoreError('This saved section was not found. It may have been deleted. Nothing was saved.');
  const name = cleanSavedName(change.name, all.filter((s) => s.id !== original.id));
  const saved = await deps.savedSections.rename(original.id, name, named);
  if (!saved || saved.id !== original.id || saved.name !== name) {
    throw new CoreError(`The new name for "${original.name}" did not save. It is still called "${original.name}"; try again.`);
  }
  return saved;
}

/**
 * `sections` with every section that follows `original` turned into a plain
 * copy holding the original's current content (WC-246): what it showed, it
 * still shows. Sections that follow other originals, and plain ones, are as
 * they were.
 */
export function copyFollowersOf(sections: readonly SiteSection[], original: SiteSavedSection): SiteSection[] {
  return sections.map((s) => (s.linked === true && s.savedSectionId === original.id ? unlinkSiteSection(following(s, original)) : s));
}

/**
 * `actorId` deletes saved section `id` (WC-246), on behalf of `tool`.
 * **First** every page that follows it is rewritten so that each section
 * following it becomes a plain copy of its current content (`copyFollowersOf`),
 * saved and read back page by page. Only when every page saved is the
 * original deleted, so no page is ever left following an original that is
 * gone. If any page did not save, nothing is deleted and the CoreError names
 * the page(s); pages already rewritten are still right, because a plain copy
 * of the current content looks the same as following it. Throws in plain
 * words when the role may not, the original is gone, or the delete did not
 * stick (rule 6). Returns the original's name and how many pages became
 * copies.
 */
export async function deleteSavedSection(
  deps: SiteSavedSectionDeleteDeps,
  change: { actorId: string; id: string },
  tool: string,
): Promise<{ name: string; pagesCopied: number }> {
  const named = requireTool(tool);
  await requireSavedManager(deps, change.actorId, 'delete saved sections');
  const original = (await deps.savedSections.list()).find((s) => s.id === change.id);
  if (!original) throw new CoreError('This saved section was not found. It may already have been deleted.');
  const followers = pagesFollowing(await deps.pages.list(), original.id);
  const failed: string[] = [];
  for (const page of followers) {
    const sections = normalizeSiteSections(copyFollowersOf(page.sections, original));
    let saved: SitePage | null = null;
    try {
      saved = await deps.pages.update(page.id, { sections }, named);
    } catch {
      saved = null;
    }
    if (!saved || saved.id !== page.id || JSON.stringify(saved.sections) !== JSON.stringify(sections)) failed.push(`"${page.name}"`);
  }
  if (failed.length) {
    const which = failed.length === 1 ? `The page ${failed[0]} could not` : `The pages ${failed.join(', ')} could not`;
    throw new CoreError(
      `${which} be turned into a plain copy of "${original.name}", so it was not deleted. Every page still shows the same content; try again.`,
    );
  }
  if (!(await deps.savedSections.remove(original.id))) {
    const copied = followers.length ? ` The ${plural(followers.length, 'page')} that followed it now hold their own copy, with the same content.` : '';
    throw new CoreError(`"${original.name}" was not deleted; try again.${copied}`);
  }
  return { name: original.name, pagesCopied: followers.length };
}

// ── Modules: headings, text, pictures, buttons and leaderboards (WC-209, WC-237) ─────────────────
//
// What fills a section's cells. Each module has an id (unique on its page), a
// type, the cell it sits in, and that type's own settings. Ported from
// Normie's `createEmptyModule` and trimmed to the four first types and the
// settings that matter to them; StarCaster's doctrine
// (docs/MODULE_UI_DOCTRINE.md there) gives each type one settings panel.
//
// Nothing here is HTML. A heading is plain words; a block of text is
// WaveCenter's rich-text format (core/richText.ts), so nothing typed can run
// in a visitor's browser. A picture's address must be https:, and a button
// may link only to http:, https: or a WaveCenter address such as "/about".
// Saving refuses anything else in plain words (`siteModulesProblem`); reading
// tidies whatever is stored (`normalizeSiteModules`) and never throws.

export const SITE_MODULE_TYPES = [
  { key: 'heading', label: 'Heading' },
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Picture' },
  { key: 'button', label: 'Button' },
  { key: 'leaderboard', label: 'Leaderboard' },
] as const;

export type SiteModuleType = (typeof SITE_MODULE_TYPES)[number]['key'];

export const SITE_HEADING_LEVELS = [
  { key: 'h1', label: 'Largest (page title)' },
  { key: 'h2', label: 'Large' },
  { key: 'h3', label: 'Medium' },
  { key: 'h4', label: 'Small' },
] as const;

export type SiteHeadingLevel = (typeof SITE_HEADING_LEVELS)[number]['key'];

/** The most a heading, a block of text, a picture's description and a button's words may hold. */
export const SITE_HEADING_MAX = 200;
export const SITE_TEXT_MAX = 5000;
export const SITE_IMAGE_ALT_MAX = 200;
export const SITE_BUTTON_LABEL_MAX = 80;
/** The most an address (a picture's or a button's link) may hold. */
export const SITE_ADDRESS_MAX = 2000;
/** A picture's width, as a share of its cell, from this to 100 percent. */
export const SITE_IMAGE_WIDTH_MIN = 10;

export interface SiteHeadingSettings { text: string; level: SiteHeadingLevel; /** "#rrggbb", or "" for the page's own colour. */ color: string }
export interface SiteTextSettings { /** WaveCenter's rich text (core/richText.ts), never HTML. */ body: string }
export interface SiteImageSettings { /** An https: address, or "" for none yet. */ url: string; /** Words describing the picture for anyone who cannot see it. */ alt: string; /** Percent of the cell's width. */ width: number }
/**
 * The Leaderboard module (WC-237): the Game leaderboard's top ten
 * (core/leaderboard.ts), name and Total only, with a link to the full board.
 * Its one setting is the heading above the list.
 */
export interface SiteLeaderboardSettings { /** Plain words; "" draws no heading. */ heading: string }

/** The heading a new Leaderboard module starts with. */
export const SITE_LEADERBOARD_HEADING = 'Leaderboard';

export interface SiteButtonSettings {
  label: string;
  /** An http: or https: address, a WaveCenter address starting "/", or "" for none yet. */
  href: string;
  /** Background and words, each "#rrggbb". */
  color: string;
  textColor: string;
  newTab: boolean;
}

interface SiteModuleBase { id: string; /** One of its section's layout cells. */ cell: string }

/** One module in a section's cell, in core's own names. */
export type SiteModule =
  | (SiteModuleBase & { type: 'heading'; settings: SiteHeadingSettings })
  | (SiteModuleBase & { type: 'text'; settings: SiteTextSettings })
  | (SiteModuleBase & { type: 'image'; settings: SiteImageSettings })
  | (SiteModuleBase & { type: 'button'; settings: SiteButtonSettings })
  | (SiteModuleBase & { type: 'leaderboard'; settings: SiteLeaderboardSettings });

const BUTTON_COLOR = '#214c71';
const BUTTON_TEXT_COLOR = '#ffffff';

function isModuleType(value: unknown): value is SiteModuleType {
  return SITE_MODULE_TYPES.some((t) => t.key === value);
}

function isHeadingLevel(value: unknown): value is SiteHeadingLevel {
  return SITE_HEADING_LEVELS.some((l) => l.key === value);
}

/** The words for a module type, for the editor ("Picture"). */
export function siteModuleLabel(type: SiteModuleType): string {
  return SITE_MODULE_TYPES.find((t) => t.key === type)?.label ?? type;
}

/**
 * A picture's address as it may be saved: "" when blank, the address when it
 * is a well-formed https: one, otherwise null (not allowed).
 */
export function siteImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const typed = raw.trim();
  if (typed === '') return '';
  if (typed.length > SITE_ADDRESS_MAX) return null;
  const href = safeHref(typed);
  // Checked again once encoded: "é" is stored as "%C3%A9", six characters.
  return href && href.startsWith('https:') && href.length <= SITE_ADDRESS_MAX ? href : null;
}

/**
 * Uploading a picture for a picture module (WC-251). The stored copy goes in
 * the public `site-images` bucket (visitors to a published page are not
 * signed in, so it is read without a link); only a role with Manage website
 * may add one. The bucket's own limits in
 * supabase/migrations/20261128140000_site_images.sql are these same values,
 * so the button and the bucket refuse the same files.
 */
export const SITE_IMAGES_BUCKET = 'site-images';
export const SITE_IMAGE_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const SITE_IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Why a picked file cannot be uploaded as a picture, in plain words, or null
 * when it may: a png, jpeg, gif or webp of at most 5 MB, with a name.
 */
export function siteImageUploadProblem(file: { name: unknown; type: unknown; sizeBytes: unknown }): string | null {
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  if (!name) return 'A picture needs a file name. Nothing was uploaded.';
  if (typeof file.type !== 'string' || !(SITE_IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return `"${name}" is not a picture WaveCenter can show. Upload a PNG, JPEG, GIF or WebP file. Nothing was uploaded.`;
  }
  if (typeof file.sizeBytes !== 'number' || !Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) {
    return `"${name}" is empty or its size could not be read. Nothing was uploaded.`;
  }
  if (file.sizeBytes > SITE_IMAGE_UPLOAD_MAX_BYTES) {
    // Rounded up, so a file only just over the cap never reads as "5.0 MB".
    const mb = Math.ceil((file.sizeBytes / (1024 * 1024)) * 10) / 10;
    return `"${name}" is ${mb.toFixed(1)} MB, and a picture can be at most 5 MB. Nothing was uploaded.`;
  }
  return null;
}

/**
 * Where a new picture is stored in the bucket: `<random id>/<file name>`,
 * awkward characters in the name replaced so it can never step into another
 * folder, and the random folder so two uploads never share an address.
 */
export function siteImagePath(randomId: string, name: string): string {
  // Cut to length first, so the cut can never leave a name starting with a dot.
  const safe = name.trim().replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120).replace(/^\.+/, '_') || 'picture';
  return `${randomId}/${safe}`;
}

/**
 * The page's sections with picture module `moduleId`'s address set to `url`,
 * wherever that module now is (WC-251). An upload finishes after the manager
 * may have edited, moved or removed other things, so it is applied to the
 * page as it is then, never to the page as it was when the upload began: the
 * rest is returned untouched, and nothing changes when the module is gone,
 * is not a picture, or sits in a section locked to its original.
 */
export function withSiteImageUrl(sections: readonly SiteSection[], moduleId: string, url: string): SiteSection[] {
  const isIt = (m: SiteModule) => m.id === moduleId && m.type === 'image';
  return sections.map((s) => (isLinkedSiteSection(s) || !s.modules.some(isIt) ? s
    : { ...s, modules: s.modules.map((m) => (isIt(m) ? { ...m, settings: { ...m.settings, url } } as SiteModule : m)) }));
}

/**
 * `actorId` asks to upload a picture (WC-251). Throws a CoreError in plain
 * words when their role may not manage the website or the file is not one a
 * picture module may show; otherwise says where in the bucket it goes. The
 * bucket's own rules refuse the same, so a direct write is refused too.
 */
export async function planSiteImageUpload(
  deps: Pick<SitePageDeps, 'roles' | 'grants'>,
  change: { actorId: string; name: unknown; type: unknown; sizeBytes: unknown; randomId: string },
): Promise<{ path: string }> {
  if (!mayManageWebsite(await roleOf(deps.roles, change.actorId), deps.grants)) {
    throw new CoreError('Your role may not manage the website. Only a role with the Manage website permission can upload pictures. Nothing was uploaded.');
  }
  const problem = siteImageUploadProblem(change);
  if (problem) throw new CoreError(problem);
  return { path: siteImagePath(change.randomId, String(change.name)) };
}

/**
 * A button's link as it may be saved: "" when blank; a WaveCenter address
 * ("/about", "/forum?x=1") as typed; a well-formed http: or https: address;
 * otherwise null (not allowed: `javascript:`, `data:`, `mailto:`, "//elsewhere").
 */
export function siteButtonHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const typed = raw.trim();
  if (typed === '') return '';
  if (typed.length > SITE_ADDRESS_MAX || /[\s\u0000-\u001f\u007f\\]/.test(typed)) return null;
  if (typed.startsWith('/')) return typed.startsWith('//') ? null : typed;
  const href = safeHref(typed);
  return href && (href.startsWith('https:') || href.startsWith('http:')) && href.length <= SITE_ADDRESS_MAX ? href : null;
}

/** Words kept as typed, line breaks and all: "\r\n" as "\n", trimmed, at most `max`. */
function body(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max).trim() : '';
}

/**
 * A picture's width as it may be saved: whole percent from
 * SITE_IMAGE_WIDTH_MIN to 100; anything not a number is 100.
 */
export function siteImageWidth(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(Math.round(n), SITE_IMAGE_WIDTH_MIN), 100);
}

function settingsOf(type: SiteModuleType, value: unknown): SiteModule['settings'] {
  const s = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  switch (type) {
    case 'heading':
      return { text: text(s.text, SITE_HEADING_MAX), level: isHeadingLevel(s.level) ? s.level : 'h2', color: colour(s.color) };
    case 'text':
      return { body: body(s.body, SITE_TEXT_MAX) };
    case 'image':
      return { url: siteImageUrl(s.url) ?? '', alt: text(s.alt, SITE_IMAGE_ALT_MAX), width: siteImageWidth(s.width) };
    case 'button':
      return {
        label: text(s.label, SITE_BUTTON_LABEL_MAX),
        href: siteButtonHref(s.href) ?? '',
        color: colour(s.color) || BUTTON_COLOR,
        textColor: colour(s.textColor) || BUTTON_TEXT_COLOR,
        newTab: s.newTab === true,
      };
    case 'leaderboard':
      // A heading never saved (an older module) takes the plain default; one cleared on purpose stays "".
      return { heading: s.heading === undefined ? SITE_LEADERBOARD_HEADING : text(s.heading, SITE_HEADING_MAX) };
  }
}

const isEntry = (m: unknown): m is Record<string, unknown> => Boolean(m) && typeof m === 'object' && !Array.isArray(m);

/**
 * Whatever is stored as a section's modules, as a well-formed list: never
 * throws. Anything but a list is no modules; an entry that is not an object,
 * or not one of the module types, is dropped. A cell the layout does not have
 * (the section's layout changed) becomes its first cell, so nothing is lost.
 * Every setting is checked: a picture address that is not https:, or a link
 * that is not allowed, is cleared; anything else not allowed takes its plain
 * default. An id missing, badly formed or already in `taken` (the page's ids
 * so far) is replaced with "module-<n>", and every id is added to `taken`.
 */
export function normalizeSiteModules(value: unknown, layout: SiteSectionLayout, taken: Set<string> = new Set()): SiteModule[] {
  if (!Array.isArray(value)) return [];
  const cells = siteSectionCells(layout);
  const entries = value.filter(isEntry).filter((m) => isModuleType(m.type));
  const kept = entries.map((m) => (typeof m.id === 'string' && SECTION_ID.test(m.id) && !taken.has(m.id) ? (taken.add(m.id), m.id) : null));
  let n = 0;
  return entries.map((m, i) => {
    let id = kept[i];
    if (id === null) {
      do id = `module-${++n}`; while (taken.has(id));
      taken.add(id);
    }
    const type = m.type as SiteModuleType;
    const cell = typeof m.cell === 'string' && cells.includes(m.cell) ? m.cell : cells[0];
    return { id, type, cell, settings: settingsOf(type, m.settings) } as SiteModule;
  });
}

/**
 * The modules of a section whose layout is now `layout`: each module in a
 * cell the layout does not have moves to its first cell, as on read-back
 * (normalizeSiteModules), so changing a layout never hides a module.
 * Returns the same list when nothing moves.
 */
export function siteModulesInLayout(modules: readonly SiteModule[], layout: SiteSectionLayout): SiteModule[] {
  const cells = siteSectionCells(layout);
  if (modules.every((m) => cells.includes(m.cell))) return modules as SiteModule[];
  return modules.map((m) => (cells.includes(m.cell) ? m : { ...m, cell: cells[0] }));
}

const shown = (value: string) => (value.length > 60 ? `${value.slice(0, 57)}…` : value);

/**
 * What is wrong with one module as typed, in words for a person, or null when
 * it may be saved. Only what the tidy-up would otherwise silently clear is
 * named: a picture address that is not https:, a link that is not allowed,
 * or a kind of module WaveCenter does not have.
 */
export function siteModuleProblem(module: unknown): string | null {
  if (!isEntry(module)) return 'A module was not readable.';
  if (!isModuleType(module.type)) return `"${shown(String(module.type))}" is not a kind of module WaveCenter has (heading, text, picture, button or leaderboard).`;
  const s = isEntry(module.settings) ? module.settings : {};
  if (module.type === 'image' && s.url !== undefined && siteImageUrl(s.url) === null) {
    return `The picture address "${shown(String(s.url))}" cannot be used. A picture's address must be a secure web address, starting with https://.`;
  }
  if (module.type === 'button' && s.href !== undefined && siteButtonHref(s.href) === null) {
    return `The button link "${shown(String(s.href))}" cannot be used. A button may link to a web address starting with https:// or http://, or to a WaveCenter page such as /about.`;
  }
  return null;
}

/** The first problem with any module in these sections as sent, naming where it is, or null. */
export function siteModulesProblem(sections: unknown): string | null {
  if (!Array.isArray(sections)) return null;
  for (const [i, s] of sections.entries()) {
    if (!isEntry(s) || s.modules === undefined) continue;
    if (!Array.isArray(s.modules)) return `Section ${i + 1}'s modules must be a list.`;
    for (const [j, m] of s.modules.entries()) {
      const problem = siteModuleProblem(m);
      if (problem) return `Section ${i + 1}, module ${j + 1}: ${problem}`;
    }
  }
  return null;
}

/** A fresh module id, unlike any on the page. */
export function newSiteModuleId(sections: readonly { modules: readonly { id: string }[] }[] = []): string {
  const taken = new Set(sections.flatMap((s) => s.modules.map((m) => m.id)));
  for (;;) {
    const id = `module-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
}

/** A new module of `type` in `cell`, with its plain starting settings and an id unlike any on the page. */
export function newSiteModule(type: SiteModuleType, cell: string, sections: readonly { modules: readonly { id: string }[] }[] = []): SiteModule {
  const id = newSiteModuleId(sections);
  switch (type) {
    case 'heading':
      return { id, cell, type, settings: { text: 'New heading', level: 'h2', color: '' } };
    case 'text':
      return { id, cell, type, settings: { body: '' } };
    case 'image':
      return { id, cell, type, settings: { url: '', alt: '', width: 100 } };
    case 'button':
      return { id, cell, type, settings: { label: 'Button', href: '', color: BUTTON_COLOR, textColor: BUTTON_TEXT_COLOR, newTab: false } };
    case 'leaderboard':
      return { id, cell, type, settings: { heading: SITE_LEADERBOARD_HEADING } };
  }
}

// ── The public page (WC-210) ────────────────────────────────────────────
// A published page shows to anyone at `/site/<address>`. Row-level security
// already hides drafts from a visitor, but a member with Manage website can
// read drafts too, so the public screen asks core as well: only a published
// page at exactly this address is shown, to everyone alike.

/** Where a page shows to the public. */
export function sitePagePath(slug: string): string {
  return `/site/${slug}`;
}

/** The page to show at `slug`, or null: a draft, another address or no page at all shows "no such page". */
export function publicSitePage(page: SitePage | null | undefined, slug: string): SitePage | null {
  if (!page || !isSitePageSlug(slug)) return null;
  return page.isPublished && page.slug === slug ? page : null;
}

/** How a section is laid out, in CSS property names, for every screen that draws one. */
export function siteSectionStyle(section: SiteSection): {
  gridTemplateColumns: string; textAlign: SiteSectionAlignment; marginTop: number; marginBottom: number; background?: string;
} {
  return {
    gridTemplateColumns: siteSectionGrid(section.layout),
    textAlign: section.alignment,
    marginTop: section.marginTop,
    marginBottom: section.marginBottom,
    ...(section.background ? { background: section.background } : {}),
  };
}

/**
 * Whether a module draws anything on a live page. A heading or text with no
 * words, or a picture with no usable address, draws nothing there (the
 * editor names what is missing instead); a button and a leaderboard always
 * draw (a leaderboard says in words when it has nobody to show).
 * SiteModuleView asks this, so the two never disagree.
 */
export function siteModuleDrawsLive(module: SiteModule): boolean {
  switch (module.type) {
    case 'heading':
      return module.settings.text.trim() !== '';
    case 'text':
      return module.settings.body.trim() !== '';
    case 'image':
      return Boolean(siteImageUrl(module.settings.url));
    case 'button':
    case 'leaderboard':
      return true;
  }
}

/**
 * Whether a page shows anything to a visitor: some section holds a module
 * that draws live. A page with no sections, or only empty ones, says
 * "nothing on it yet" instead of a blank screen (rule 7).
 */
export function sitePageHasContent(sections: readonly SiteSection[]): boolean {
  return sections.some((s) => s.modules.some(siteModuleDrawsLive));
}

// ---------------------------------------------------------------------------
// Screen widths (WC-211): phone, tablet and desktop
//
// A section can be hidden on a phone or on a desktop, and its columns can
// stack on a phone. What counts as a phone or a desktop is the width of the
// page itself, not of the browser window: the page is a CSS container
// (`.site-page` in app/globals.css) and the rules are container queries at
// these same numbers. So the editor's preview, a box 390 pixels wide, gets
// exactly the rules a visitor's phone gets, with no copy of them to drift
// (StarCaster's lesson, builder-device-preview.tsx: a narrow box in a wide
// window never matches a window-width rule). A test holds the CSS to these
// numbers.

/** The widest page, in CSS pixels, that counts as a phone. */
export const SITE_PHONE_MAX_WIDTH = 639;
/** The narrowest page, in CSS pixels, that counts as a desktop. Between the two is a tablet. */
export const SITE_DESKTOP_MIN_WIDTH = 960;

/** The screens the editor previews, in the order it offers them, each at a typical width (StarCaster's sizes; desktop a common laptop). */
export const SITE_DEVICES = [
  { key: 'phone', label: 'Phone', width: 390 },
  { key: 'tablet', label: 'Tablet', width: 820 },
  { key: 'desktop', label: 'Desktop', width: 1280 },
] as const;

export type SiteDevice = (typeof SITE_DEVICES)[number]['key'];

/** Whether a section is drawn on this screen: a tablet shows every section. */
export function siteSectionShowsOn(section: SiteSection, device: SiteDevice): boolean {
  if (device === 'phone') return !section.hideOnPhone;
  if (device === 'desktop') return !section.hideOnDesktop;
  return true;
}

/** The class names that carry a section's per-screen settings to the CSS. */
export function siteSectionClasses(section: SiteSection): string[] {
  return [
    ...(section.hideOnPhone ? ['site-hide-phone'] : []),
    ...(section.hideOnDesktop ? ['site-hide-desktop'] : []),
    ...(section.stackOnPhone ? ['site-stack-phone'] : []),
  ];
}

/** Whether a page shows anything on this screen (rule 7: the preview names an empty screen rather than drawing a blank). */
export function sitePageHasContentOn(sections: readonly SiteSection[], device: SiteDevice): boolean {
  return sitePageHasContent(sections.filter((s) => siteSectionShowsOn(s, device)));
}
