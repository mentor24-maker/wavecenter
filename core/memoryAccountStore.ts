/**
 * Accounts kept in memory, for core's tests. It does what Supabase Auth and
 * the auth.users score trigger do together: a new email makes an account and
 * credits the new member with `joined_wavecenter`, naming the tool in its
 * user metadata, all in one save. An email already registered makes nothing.
 */
import { ACCOUNT_FALLBACK_TOOL } from './accounts.ts';
import { recordEngagement, type EngagementStore } from './game.ts';

export class MemoryAccountStore {
  readonly accounts = new Map<string, string>();
  private next = 1;
  private readonly engagements: EngagementStore;

  constructor(engagements: EngagementStore) {
    this.engagements = engagements;
  }

  /** Returns the new member's id, or null when the email is already registered. */
  async create(email: string, data: { tool?: string } = {}): Promise<string | null> {
    if (this.accounts.has(email)) return null;
    const id = `member-${this.next++}`;
    // Score first: if that fails, the account is not made either, as in one transaction.
    await recordEngagement(this.engagements, { memberId: id, kind: 'joined_wavecenter', tool: data.tool?.trim() || ACCOUNT_FALLBACK_TOOL });
    this.accounts.set(email, id);
    return id;
  }
}
