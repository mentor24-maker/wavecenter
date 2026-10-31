/**
 * Teams: named groups of members (Dane, 2026-10-30: "a CRUD table for all
 * existing Teams. Teams include the Team name, slug, description … The
 * members of any given team are associated with it, so they can be listed as
 * members of the team, subject to their own privacy settings"). Who may do
 * what is the role's permissions (core/members.ts): `team.read` views the
 * teams (every role), `team.edit` makes, changes and deletes them and their
 * member lists (admin and editor; Dane, 2026-10-30, "B").
 *
 * The "more TBD" team fields are later work. Members do not join or leave a
 * team themselves yet; a manager adds and removes them.
 *
 * Like roles (core/members.ts), teams are reached through a store a client
 * supplies, and every change names its tool. The database's row-level
 * security repeats who may do what (supabase/migrations/20261031120000_teams.sql).
 */
import { STARTING_ROLE_PERMISSIONS, mayDo, roleOf, type MemberRoleStore, type RoleKey } from './members.ts';
import { CoreError, requireTool } from './tool.ts';

/** The longest name, slug and description a team holds. The migration checks the same. */
export const TEAM_NAME_MAX = 80;
export const TEAM_SLUG_MAX = 60;
export const TEAM_DESCRIPTION_MAX = 500;

/** Lowercase letters and digits, in words joined by single hyphens. The migration checks the same. */
export const TEAM_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One team, in core's own names. */
export interface Team {
  id: string;
  name: string;
  /** The team's short web-address name, unique across WaveCenter. */
  slug: string;
  /** Null means none. */
  description: string | null;
  /** The tool that last changed this record. */
  tool: string;
  createdAt: string;
  /** Null once the member who made it has left. */
  createdBy: string | null;
}

/** What a manager asks to save. A blank slug is made from the name; a blank description means none. */
export interface TeamInput {
  name: string;
  slug: string;
  description: string | null;
}

/** A team's fields once core has checked and tidied them. */
export type TeamFields = Pick<Team, 'name' | 'slug' | 'description'>;

/** What core needs from storage for teams. */
export interface TeamStore {
  get(id: string): Promise<Team | null>;
  /** Is the slug used by a team other than `exceptId`? */
  slugInUse(slug: string, exceptId?: string): Promise<boolean>;
  /** Make the team. Returns what was saved, or null if nothing was. */
  insert(fields: TeamFields, tool: string): Promise<Team | null>;
  /** Change the team. Returns what is now saved, or null if nothing was. */
  update(id: string, fields: TeamFields, tool: string): Promise<Team | null>;
  /** Delete the team and its member links. True only if a team was deleted. */
  remove(id: string, tool: string): Promise<boolean>;
  hasMember(teamId: string, memberId: string): Promise<boolean>;
  /** True only if the member is now on the team. */
  addMember(teamId: string, memberId: string, tool: string): Promise<boolean>;
  /** True only if a link was removed. */
  removeMember(teamId: string, memberId: string, tool: string): Promise<boolean>;
}

/** What a team change needs: the teams, the actor's role, and the grants the database holds (the starting ones if not given). */
export interface TeamDeps {
  teams: TeamStore;
  roles: MemberRoleStore;
  grants?: Readonly<Record<string, readonly string[]>>;
}

export function mayViewTeams(
  role: RoleKey | null | undefined,
  grants: Readonly<Record<string, readonly string[]>> = STARTING_ROLE_PERMISSIONS,
): boolean {
  return mayDo(role, 'team.read', grants);
}

export function mayManageTeams(
  role: RoleKey | null | undefined,
  grants: Readonly<Record<string, readonly string[]>> = STARTING_ROLE_PERMISSIONS,
): boolean {
  return mayDo(role, 'team.edit', grants);
}

/** A slug suggested from a team's name: "Test Team!" becomes "test-team". */
export function slugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TEAM_SLUG_MAX)
    .replace(/-+$/, '');
}

/** The plain-words reason a slug is taken. */
export function slugTakenMessage(slug: string): string {
  return `The slug "${slug}" is already taken by another team. Pick a different one.`;
}

/** Check and tidy what a manager typed. Throws a CoreError saying what to fix. */
export function checkTeam(input: TeamInput): TeamFields {
  const name = (input.name ?? '').trim();
  if (!name) throw new CoreError('A team needs a name.');
  if (name.length > TEAM_NAME_MAX) throw new CoreError(`A team name can be at most ${TEAM_NAME_MAX} characters.`);
  const typed = (input.slug ?? '').trim();
  const slug = typed || slugFromName(name);
  if (!slug) throw new CoreError('A team needs a slug: lowercase letters, digits and hyphens, for example "design-team".');
  if (slug.length > TEAM_SLUG_MAX) throw new CoreError(`A slug can be at most ${TEAM_SLUG_MAX} characters.`);
  if (!TEAM_SLUG_PATTERN.test(slug)) {
    throw new CoreError(
      `"${slug}" is not a slug WaveCenter can use. Use only lowercase letters, digits and single hyphens between words, for example "design-team".`,
    );
  }
  const description = (input.description ?? '').trim() || null;
  if (description && description.length > TEAM_DESCRIPTION_MAX) {
    throw new CoreError(`A team description can be at most ${TEAM_DESCRIPTION_MAX} characters.`);
  }
  return { name, slug, description };
}

async function requireManager(deps: TeamDeps, actorId: string, doing: string): Promise<void> {
  if (!mayManageTeams(await roleOf(deps.roles, actorId), deps.grants)) {
    throw new CoreError(`Only an admin or an editor can ${doing}.`);
  }
}

async function requireTeam(deps: TeamDeps, teamId: string): Promise<Team> {
  const team = await deps.teams.get(teamId);
  if (!team) throw new CoreError('That team no longer exists. Reload the page to see the teams as they are now.');
  return team;
}

/** `actorId` makes a team, on behalf of `tool`. */
export async function createTeam(
  deps: TeamDeps,
  change: { actorId: string } & TeamInput,
  tool: string,
): Promise<Team> {
  const named = requireTool(tool);
  await requireManager(deps, change.actorId, 'make a team');
  const fields = checkTeam(change);
  if (await deps.teams.slugInUse(fields.slug)) throw new CoreError(slugTakenMessage(fields.slug));
  const saved = await deps.teams.insert(fields, named);
  if (!saved || saved.slug !== fields.slug) throw new CoreError('The team did not save. Nothing changed; try again.');
  return saved;
}

/** `actorId` changes a team's name, slug or description, on behalf of `tool`. */
export async function updateTeam(
  deps: TeamDeps,
  change: { actorId: string; teamId: string } & TeamInput,
  tool: string,
): Promise<Team> {
  const named = requireTool(tool);
  await requireManager(deps, change.actorId, 'change a team');
  const fields = checkTeam(change);
  await requireTeam(deps, change.teamId);
  if (await deps.teams.slugInUse(fields.slug, change.teamId)) throw new CoreError(slugTakenMessage(fields.slug));
  const saved = await deps.teams.update(change.teamId, fields, named);
  if (!saved || saved.name !== fields.name || saved.slug !== fields.slug || saved.description !== fields.description) {
    throw new CoreError('The change did not save. The team is as it was; try again.');
  }
  return saved;
}

/** `actorId` deletes a team and its member links, never a member account, on behalf of `tool`. */
export async function deleteTeam(deps: TeamDeps, change: { actorId: string; teamId: string }, tool: string): Promise<void> {
  const named = requireTool(tool);
  await requireManager(deps, change.actorId, 'delete a team');
  await requireTeam(deps, change.teamId);
  if (!(await deps.teams.remove(change.teamId, named))) throw new CoreError('The team was not deleted. Try again.');
}

/** `actorId` puts `memberId` on a team, on behalf of `tool`. */
export async function addTeamMember(
  deps: TeamDeps,
  change: { actorId: string; teamId: string; memberId: string },
  tool: string,
): Promise<void> {
  const named = requireTool(tool);
  await requireManager(deps, change.actorId, "change a team's members");
  await requireTeam(deps, change.teamId);
  if (!change.memberId) throw new CoreError('Pick a member to add.');
  if (await deps.teams.hasMember(change.teamId, change.memberId)) throw new CoreError('That member is already on this team.');
  if (!(await deps.teams.addMember(change.teamId, change.memberId, named))) {
    throw new CoreError('The member was not added. Nothing changed; try again.');
  }
}

/** `actorId` takes `memberId` off a team, on behalf of `tool`. Their account is untouched. */
export async function removeTeamMember(
  deps: TeamDeps,
  change: { actorId: string; teamId: string; memberId: string },
  tool: string,
): Promise<void> {
  const named = requireTool(tool);
  await requireManager(deps, change.actorId, "change a team's members");
  await requireTeam(deps, change.teamId);
  if (!(await deps.teams.hasMember(change.teamId, change.memberId))) throw new CoreError('That member is not on this team.');
  if (!(await deps.teams.removeMember(change.teamId, change.memberId, named))) {
    throw new CoreError('The member was not removed. Nothing changed; try again.');
  }
}
