/**
 * The website's pages kept in memory, for core's tests. The rules about who
 * may make, change or delete a page are core's, so this store does not repeat
 * them; like the database, it refuses an address already used.
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

  async update(id: string, patch: { name?: string; slug?: string; isPublished?: boolean }) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    const i = this.rows.findIndex((p) => p.id === id);
    if (i < 0) return null;
    if (patch.slug !== undefined && this.rows.some((p) => p.slug === patch.slug && p.id !== id)) {
      throw new Error('duplicate key value violates unique constraint "site_pages_slug_key"');
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
