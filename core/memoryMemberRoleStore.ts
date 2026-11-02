/**
 * Members' roles kept in memory, for core's tests. Like the database's
 * `set_member_role`, it records the role and the tool; the rules about who
 * may change a role are core's, so this store does not repeat them.
 *
 * Given an engagement store, it also does what the table's score trigger
 * does: a role saved as a different role is scored for `signedIn`, the
 * member the database would see as signed in (the admin who changed it,
 * never the member whose role changed).
 */
import { DEFAULT_ROLE, type MemberRoleStore, type RoleKey } from './members.ts';
import { recordEngagement, type EngagementStore } from './game.ts';

export class MemoryMemberRoleStore implements MemberRoleStore {
  readonly rows = new Map<string, { role: RoleKey; tool: string }>();
  /** Set to make the next save fail the way a refused write does. */
  failNextSave = false;
  /** Who the database would see as signed in: the admin credited for changing a role. */
  signedIn: string | null = null;
  private readonly engagements: EngagementStore | null;

  constructor(engagements: EngagementStore | null = null) {
    this.engagements = engagements;
  }

  async roleOf(memberId: string) {
    return this.rows.get(memberId)?.role ?? null;
  }

  async adminCount() {
    return [...this.rows.values()].filter((r) => r.role === 'admin').length;
  }

  async setRole(memberId: string, role: RoleKey, tool: string) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    // Score first: if that fails, the role is not changed either, as in one transaction.
    const before = this.rows.get(memberId)?.role ?? DEFAULT_ROLE;
    if (this.engagements && this.signedIn && before !== role) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'changed_a_member_s_role', tool });
    }
    this.rows.set(memberId, { role, tool });
    return role;
  }
}
