/**
 * The website's pages kept in memory, for core's tests. The rules about who
 * may make a page are core's, so this store does not repeat them; like the
 * database, it refuses an address already used.
 */
import type { SitePage, SitePageStore } from './website.ts';

export class MemorySitePageStore implements SitePageStore {
  readonly rows: SitePage[] = [];
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;

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
    const saved: SitePage = { id: `page-${this.rows.length + 1}`, ...row, isPublished: false, createdBy: null, createdAt: now, updatedAt: now };
    this.rows.push(saved);
    return saved;
  }
}
