/**
 * A `ProposalStore` that keeps proposals in memory, acting as one member.
 * Core's tests use it so the rules can be checked without a database; it
 * behaves like the real table on the points that matter (owner set for you,
 * timestamps kept, only the member's own proposals changed or deleted,
 * sub-proposals kept as top-level when their parent is deleted). Two stores
 * given the same `rows` are two members looking at one table. Given an
 * engagement store, a new proposal is scored for the member who made it, as
 * `proposals_score` does; if the engagement cannot be written, the proposal
 * is not saved either.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { NewProposalRow, Proposal, ProposalRowChanges, ProposalStore } from './proposals.ts';

let next = 1;

export class MemoryProposalStore implements ProposalStore {
  readonly rows: Map<string, Proposal>;
  private readonly ownerId: string;
  private readonly engagements: EngagementStore | null;

  constructor(ownerId = 'member-1', rows: Map<string, Proposal> = new Map(), engagements: EngagementStore | null = null) {
    this.ownerId = ownerId;
    this.rows = rows;
    this.engagements = engagements;
  }

  private own(id: string): Proposal | null {
    const proposal = this.rows.get(id);
    return proposal && proposal.ownerId === this.ownerId ? proposal : null;
  }

  async insert(row: NewProposalRow): Promise<Proposal> {
    const now = new Date().toISOString();
    const proposal: Proposal = { ...row, id: `proposal-${next++}`, ownerId: this.ownerId, createdAt: now, updatedAt: now };
    // Scored in the same save, before it lands: no engagement, no proposal.
    if (this.engagements) {
      await recordEngagement(this.engagements, { memberId: this.ownerId, kind: 'made_a_proposal', tool: row.tool });
    }
    this.rows.set(proposal.id, proposal);
    return { ...proposal };
  }

  async get(id: string): Promise<Proposal | null> {
    const proposal = this.own(id);
    return proposal ? { ...proposal } : null;
  }

  async update(id: string, changes: ProposalRowChanges): Promise<Proposal | null> {
    const proposal = this.own(id);
    if (!proposal) return null;
    const updated: Proposal = { ...proposal, ...changes, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return { ...updated };
  }

  async remove(id: string): Promise<boolean> {
    if (!this.own(id)) return false;
    this.rows.delete(id);
    // Like the database's "on delete set null".
    for (const proposal of this.rows.values()) if (proposal.parentProposalId === id) proposal.parentProposalId = null;
    return true;
  }
}
