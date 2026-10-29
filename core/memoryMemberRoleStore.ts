/**
 * Members' roles kept in memory, for core's tests. Like the database's
 * `set_member_role`, it records the role and the tool; the rules about who
 * may change a role are core's, so this store does not repeat them.
 */
import type { MemberRoleStore, RoleKey } from './members.ts';

export class MemoryMemberRoleStore implements MemberRoleStore {
  readonly rows = new Map<string, { role: RoleKey; tool: string }>();
  /** Set to make the next save fail the way a refused write does. */
  failNextSave = false;

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
    this.rows.set(memberId, { role, tool });
    return role;
  }
}
