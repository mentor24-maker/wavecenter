/**
 * The token sizes kept in memory, for core's tests. The rules about who may
 * change them and what a size may be are core's, so this store does not
 * repeat them.
 *
 * Given an engagement store, it scores adding and changing a size the way
 * the table's game-layer triggers do
 * (supabase/migrations/20261123230000_score_added_a_token_size.sql and
 * supabase/migrations/20261124010000_score_changed_a_token_size.sql): each
 * size added records one "added_a_token_size" engagement, and each saved
 * change to a size's name, size, colour or point level records one
 * "changed_a_token_size" engagement, for the signed-in member, naming the
 * tool. A change that alters none of them, or any write with nobody signed
 * in (a service-key write), is saved unscored. If the engagement cannot be
 * written, the size or the change is not saved either.
 *
 * It also scores deleting a size the way the table's
 * game-layer trigger does (supabase/migrations/20261124020000_score_deleted_a_token_size.sql):
 * each size deleted records one "deleted_a_token_size" engagement for the
 * signed-in member, naming the tool; a delete with nobody signed in (a
 * service-key write) removes the size unscored. If the engagement cannot be
 * written, the size is not deleted either.
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
    const before = this.rows.get(id);
    if (this.failed() || !before) return null;
    const saved: TokenSize = { id, ...fields, tool, updatedAt: new Date().toISOString() };
    const changed = before.name !== fields.name || before.diameter !== fields.diameter || before.color !== fields.color || before.minPoints !== fields.minPoints;
    // Score first: if that fails, the change is not saved either, as in one transaction.
    if (changed && this.engagements && this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'changed_a_token_size', tool });
    }
    this.rows.set(id, saved);
    return saved;
  }

  async remove(id: string, tool: string) {
    if (this.failed() || !this.rows.has(id)) return false;
    // Score first: if that fails, the size is not deleted either, as in one transaction.
    if (this.engagements && this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'deleted_a_token_size', tool });
    }
    return this.rows.delete(id);
  }
}
