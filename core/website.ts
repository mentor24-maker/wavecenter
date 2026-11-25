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
 * draft, and deleting it, all under the same permission. A page has a
 * name, an address (its slug: lower-case letters, digits and single hyphens)
 * and, for the editor to come, its layout sections. A new page is a draft:
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
}

/** What core needs from storage for the website's pages. */
export interface SitePageStore {
  /** Every page the caller may see. */
  list(): Promise<SitePage[]>;
  /** Save a new draft page. Returns what is now saved, or null if nothing was. */
  insert(row: { name: string; slug: string; tool: string }): Promise<SitePage | null>;
  /** Change a page's name, address or published state. Returns what is now saved, or null if no page changed. */
  update(id: string, patch: { name?: string; slug?: string; isPublished?: boolean }): Promise<SitePage | null>;
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
