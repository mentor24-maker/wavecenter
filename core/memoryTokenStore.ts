/**
 * The token sizes kept in memory, for core's tests. The rules about who may
 * change them and what a size may be are core's, so this store does not
 * repeat them.
 */
import type { TokenSize, TokenSizeFields, TokenStore } from './tokens.ts';

export class MemoryTokenStore implements TokenStore {
  readonly rows = new Map<string, TokenSize>();
  /** Set to make the next write fail the way a refused write does. */
  failNextWrite = false;
  private next = 1;

  async list() {
    return [...this.rows.values()].sort((a, b) => a.minPoints - b.minPoints);
  }

  private failed() {
    if (!this.failNextWrite) return false;
    this.failNextWrite = false;
    return true;
  }

  async add(fields: TokenSizeFields, tool: string) {
    if (this.failed()) return null;
    const saved: TokenSize = { id: `size-${this.next++}`, ...fields, tool, updatedAt: new Date().toISOString() };
    this.rows.set(saved.id, saved);
    return saved;
  }

  async change(id: string, fields: TokenSizeFields, tool: string) {
    if (this.failed() || !this.rows.has(id)) return null;
    const saved: TokenSize = { id, ...fields, tool, updatedAt: new Date().toISOString() };
    this.rows.set(id, saved);
    return saved;
  }

  async remove(id: string) {
    if (this.failed()) return false;
    return this.rows.delete(id);
  }
}
