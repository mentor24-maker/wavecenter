/**
 * The website's pages kept in memory, for core's tests. The rules about who
 * may make, change or delete a page are core's, so this store does not repeat
 * them; like the database, it refuses an address already used.
 *
 * Given an engagement store, it scores making and publishing a page the way
 * the table's game-layer triggers do
 * (supabase/migrations/20261124150000_score_made_a_page.sql): each page made
 * records one "made_a_page" engagement for its maker, and each change of a
 * page from draft to published records one "published_a_page" engagement
 * for the member signed in, each naming the tool. Any write with nobody
 * signed in (a service-key write) is saved unscored. If the engagement
 * cannot be written, the page or the change is not saved either.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { SitePage, SitePageStore } from './website.ts';

export class MemorySitePageStore implements SitePageStore {
  readonly rows: SitePage[] = [];
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;
  /** Who is signed in, as `auth.uid()` is for the table. */
  signedIn: string | null = null;
  private readonly engagements: EngagementStore | null;

  constructor(engagements: EngagementStore | null = null) {
    this.engagements = engagements;
  }

  async list() {
    return [...this.rows];
  }

  async insert(row: { name: string; slug: string; tool: string }) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    if (this.rows.some((p) => p.slug === row.slug)) throw new Error('duplicate key value violates unique constraint "site_pages_slug_key"');
    const now = new Date().toISOString();
    const saved: SitePage = { id: `page-${this.rows.length + 1}`, ...row, isPublished: false, createdBy: this.signedIn, createdAt: now, updatedAt: now };
    // Score first: if that fails, the page is not saved either, as in one transaction.
    if (this.engagements && this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'made_a_page', tool: row.tool });
    }
    this.rows.push(saved);
    return saved;
  }

  async update(id: string, patch: { name?: string; slug?: string; isPublished?: boolean }, tool: string) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    const i = this.rows.findIndex((p) => p.id === id);
    if (i < 0) return null;
    if (patch.slug !== undefined && this.rows.some((p) => p.slug === patch.slug && p.id !== id)) {
      throw new Error('duplicate key value violates unique constraint "site_pages_slug_key"');
    }
    if (this.engagements && this.signedIn && patch.isPublished === true && !this.rows[i].isPublished) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'published_a_page', tool });
    }
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    this.rows[i] = { ...this.rows[i], ...defined, updatedAt: new Date().toISOString() };
    return { ...this.rows[i] };
  }

  async remove(id: string) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return false;
    }
    const i = this.rows.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.rows.splice(i, 1);
    return true;
  }
}
