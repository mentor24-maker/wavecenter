/**
 * Teams kept in memory, for core's tests. Like the database, a slug is
 * unique and deleting a team takes its member links with it; the rules about
 * who may change a team are core's, so this store does not repeat them.
 *
 * Like the table, it stamps the signed-in member as a team's maker; given an
 * engagement store, it scores making a team the way the table's game-layer
 * trigger does, all-or-nothing. It scores changing one the same way
 * (supabase/migrations/20261102170000_score_changed_a_team.sql): a saved
 * change to a team's name, slug or description records one "changed_a_team"
 * engagement for the signed-in member, a save that changes nothing records
 * none, and if the engagement cannot be written the change is not saved either.
 * It scores deleting a team for the signed-in member the same way
 * (supabase/migrations/20261102171000_score_deleted_a_team.sql),
 * all-or-nothing; the member links that go with it are not scored.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { Team, TeamFields, TeamStore } from './teams.ts';

export class MemoryTeamStore implements TeamStore {
  readonly teams = new Map<string, Team>();
  /** team id → member ids, with the tool that added each. */
  readonly members = new Map<string, Map<string, string>>();
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;
  /** Who is signed in, as `auth.uid()` is for the table. */
  signedIn: string | null = null;
  private next = 1;
  private readonly engagements: EngagementStore | null;

  constructor(engagements: EngagementStore | null = null) {
    this.engagements = engagements;
  }

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
    const team: Team = { id: `team-${this.next++}`, ...fields, tool, createdAt: new Date().toISOString(), createdBy: this.signedIn };
    if (this.engagements && team.createdBy) {
      await recordEngagement(this.engagements, { memberId: team.createdBy, kind: 'made_a_team', tool });
    }
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

  async remove(id: string, tool: string) {
    if (this.failed() || !this.teams.has(id)) return false;
    if (this.engagements && this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'deleted_a_team', tool });
    }
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
