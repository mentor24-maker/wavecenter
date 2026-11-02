/**
 * Teams kept in memory, for core's tests. Like the database, a slug is
 * unique and deleting a team takes its member links with it; the rules about
 * who may change a team are core's, so this store does not repeat them.
 *
 * Given an engagement store, it also does what the table's game-layer trigger
 * does (supabase/migrations/20261102130000_score_changed_a_team.sql): a saved
 * change to a team's name, slug or description records one "changed_a_team"
 * engagement for the signed-in member, a save that changes nothing records
 * none, and if the engagement cannot be written the change is not saved either.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { Team, TeamFields, TeamStore } from './teams.ts';

export class MemoryTeamStore implements TeamStore {
  /** Who is signed in, as the database's auth.uid() is: the member a change is credited to. */
  signedIn: string | null = null;
  private readonly engagements: EngagementStore | null;

  constructor(engagements: EngagementStore | null = null) {
    this.engagements = engagements;
  }

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
    const changed = saved.name !== team.name || saved.slug !== team.slug || saved.description !== team.description;
    if (this.engagements && this.signedIn && changed) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'changed_a_team', tool });
    }
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
