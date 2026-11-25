/**
 * The website's saved sections kept in memory, for core's tests (WC-212).
 * The rules about who may save or change one are core's, so this store does
 * not repeat them. Like the database it stores a copy, so a later change to
 * the caller's object does not reach it.
 */
import { randomUUID } from 'node:crypto';
import type { SiteSavedSection, SiteSavedSectionStore, SiteSection } from './website.ts';

export class MemorySiteSavedSectionStore implements SiteSavedSectionStore {
  readonly rows: SiteSavedSection[] = [];
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;
  /** Who is signed in, as `auth.uid()` is for the table. */
  signedIn: string | null = null;

  async list() {
    return structuredClone(this.rows);
  }

  async insert(row: { name: string; section: SiteSection; tool: string }) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    const now = new Date().toISOString();
    const saved: SiteSavedSection = { id: randomUUID(), name: row.name, section: structuredClone(row.section), tool: row.tool, createdBy: this.signedIn, createdAt: now, updatedAt: now };
    this.rows.push(saved);
    return structuredClone(saved);
  }

  async update(id: string, patch: { section: SiteSection }) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    const i = this.rows.findIndex((s) => s.id === id);
    if (i < 0) return null;
    this.rows[i] = { ...this.rows[i], section: structuredClone(patch.section), updatedAt: new Date().toISOString() };
    return structuredClone(this.rows[i]);
  }
}
