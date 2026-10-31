/**
 * Teams kept in memory, for core's tests. Like the database, a slug is
 * unique and deleting a team takes its member links with it; the rules about
 * who may change a team are core's, so this store does not repeat them.
 */
import type { Team, TeamFields, TeamStore } from './teams.ts';

export class MemoryTeamStore implements TeamStore {
  readonly teams = new Map<string, Team>();
  /** team id → member ids, with the tool that added each. */
  readonly members = new Map<string, Map<string, string>>();
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;
  private next = 1;

  private failed() {
    if (!this.failNextSave) return false;
    this.failNextSave = false;
    return true;
  }

  async get(id: string) {
    return this.teams.get(id) ?? null;
  }

  async slugInUse(slug: string, exceptId?: string) {
    return [...this.teams.values()].some((t) => t.slug === slug && t.id !== exceptId);
  }

  async insert(fields: TeamFields, tool: string) {
    if (this.failed()) return null;
    const team: Team = { id: `team-${this.next++}`, ...fields, tool, createdAt: new Date().toISOString(), createdBy: null };
    this.teams.set(team.id, team);
    return team;
  }

  async update(id: string, fields: TeamFields, tool: string) {
    const team = this.teams.get(id);
    if (!team || this.failed()) return null;
    const saved = { ...team, ...fields, tool };
    this.teams.set(id, saved);
    return saved;
  }

  async remove(id: string) {
    if (this.failed()) return false;
    this.members.delete(id);
    return this.teams.delete(id);
  }

  async hasMember(teamId: string, memberId: string) {
    return this.members.get(teamId)?.has(memberId) ?? false;
  }

  async addMember(teamId: string, memberId: string, tool: string) {
    if (!this.teams.has(teamId) || this.failed()) return false;
    let on = this.members.get(teamId);
    if (!on) this.members.set(teamId, (on = new Map()));
    on.set(memberId, tool);
    return true;
  }

  async removeMember(teamId: string, memberId: string) {
    if (this.failed()) return false;
    return this.members.get(teamId)?.delete(memberId) ?? false;
  }
}
