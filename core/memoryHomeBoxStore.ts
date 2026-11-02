/**
 * Home's box words kept in memory, for core's tests. The rules about who may
 * change them are core's, so this store does not repeat them.
 */
import type { HomeBox, HomeBoxKey, HomeBoxStore } from './homeBoxes.ts';

export class MemoryHomeBoxStore implements HomeBoxStore {
  readonly rows = new Map<HomeBoxKey, HomeBox>();
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;

  async list() {
    return [...this.rows.values()];
  }

  async save(box: HomeBoxKey, body: string, tool: string) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    const saved: HomeBox = { box, body, tool, updatedAt: new Date().toISOString(), updatedBy: null };
    this.rows.set(box, saved);
    return saved;
  }
}
