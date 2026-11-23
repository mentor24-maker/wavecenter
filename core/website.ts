/**
 * The website manager: WaveCenter's own page builder, reached from the Admin
 * page (Dane, 2026-11-22, WC-206: "WaveCenter needs it's own page builder
 * along the lines of Starcaster and Normie. Cannibalize both of those
 * repositories to develop a new and improved version for WaveCenter. Link to
 * it from the Admin page for now."). He chose "A" on the ticket: start from
 * Normie's leaner builder and bring in StarCaster's best parts one ticket at a
 * time. The plan is docs/WEBSITE_MANAGER.md.
 *
 * This first slice holds a page's record and who may make one. A page has a
 * name, an address (its slug: lower-case letters, digits and single hyphens)
 * and, for the editor to come, its layout sections. A new page is a draft:
 * nobody outside the website managers sees it until it is published, which is
 * a later ticket.
 *
 * Who may manage the website is the role's `site.edit` permission
 * (core/members.ts), granted to admins at the start. The database's
 * row-level security repeats it (supabase/migrations/20261123120000_site_pages.sql),
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
  if (!mayManageWebsite(await roleOf(deps.roles, change.actorId), deps.grants)) {
    throw new CoreError('Your role may not manage the website. Only a role with the Manage website permission can make pages.');
  }
  const name = (change.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new CoreError('A page needs a name. Nothing was saved.');
  if (name.length > SITE_PAGE_NAME_MAX) throw new CoreError(`A page's name can be at most ${SITE_PAGE_NAME_MAX} characters.`);
  const typed = (change.slug ?? '').trim().toLowerCase().replace(/^\/+/, '');
  const slug = typed || sitePageSlug(name);
  if (!isSitePageSlug(slug)) {
    throw new CoreError(
      `"${typed}" cannot be a page's address. Use lower-case letters and digits, with single hyphens between words (for example "about-us"), at most ${SITE_PAGE_SLUG_MAX} characters.`,
    );
  }
  const twin = (await deps.pages.list()).find((p) => p.slug === slug);
  if (twin) throw new CoreError(`The address "${slug}" is already used by the page "${twin.name}". Pick another address.`);
  const saved = await deps.pages.insert({ name, slug, tool: named });
  if (!saved || saved.slug !== slug || saved.name !== name) {
    throw new CoreError('The page did not save. Nothing was made; try again.');
  }
  return saved;
}
