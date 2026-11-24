/**
 * The token sizes kept in memory, for core's tests. The rules about who may
 * change them and what a size may be are core's, so this store does not
 * repeat them.
 *
 * Given an engagement store, it scores adding a size the way the table's
 * game-layer trigger does (supabase/migrations/20261123230000_score_added_a_token_size.sql):
 * each size added records one "added_a_token_size" engagement for the
 * signed-in member, naming the tool; with nobody signed in (a service-key
 * write) the size is saved unscored. If the engagement cannot be written, the
 * size is not saved either.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { TokenSize, TokenSizeFields, TokenStore } from './tokens.ts';

export class MemoryTokenStore implements TokenStore {
  readonly rows = new Map<string, TokenSize>();
  /** Set to make the next write fail the way a refused write does. */
  failNextWrite = false;
  /** Who is signed in, as `auth.uid()` is for the table. */
  signedIn: string | null = null;
  private next = 1;
  private readonly engagements: EngagementStore | null;

  constructor(engagements: EngagementStore | null = null) {
    this.engagements = engagements;
  }

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
    // Score first: if that fails, the size is not saved either, as in one transaction.
    if (this.engagements && this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'added_a_token_size', tool });
    }
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
