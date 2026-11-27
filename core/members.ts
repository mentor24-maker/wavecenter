/**
 * Members' roles and what each role may do (Dane, 2026-10-28: "a 'roles'
 * table with … admin, editor, contributor, reviewer, viewer, a 'permissions'
 * table that will be expandable but starting with read task, create task,
 * edit task, delete task"). On 2026-10-29 he chose the first slice: roles and
 * permissions are stored and shown, and an admin changes members' roles.
 *
 * The task permissions count (WC-248): core/tasks.ts and the tasks row-level
 * security both ask them. `task.read` decides who reads the tasks,
 * `task.create` who adds one, `task.edit` and `task.delete` who changes and
 * deletes their own, and `task.edit.any` and `task.delete.any` who changes
 * and deletes anyone's. The member permissions count too: `member.read` decides
 * who may see the member list (the database's `list_members` asks it too),
 * `member.edit` who gets the role picker in each row, and `member.message`
 * who gets the Message and Chat buttons (the database's `send_message` asks it too),
 * and `home.edit` who gets the pencil on Home's boxes (core/homeBoxes.ts).
 *
 * Like the profile (core/profiles.ts), roles are reached through a store a
 * client supplies, and every change names its tool.
 */
import { CoreError, requireTool } from './tool.ts';

/** The roles, in the order they are shown. The migration seeds the same rows; a test keeps them in step. */
export const ROLES = [
  { key: 'admin', name: 'Admin', description: 'Runs WaveCenter: manages members and their roles, and may do everything on tasks.' },
  { key: 'editor', name: 'Editor', description: 'Reads, adds, changes and deletes tasks.' },
  { key: 'contributor', name: 'Contributor', description: 'Reads every task, adds tasks and changes their own.' },
  { key: 'reviewer', name: 'Reviewer', description: 'Reads every task, to review the work.' },
  { key: 'viewer', name: 'Viewer', description: 'Reads every task.' },
] as const;
export type RoleKey = (typeof ROLES)[number]['key'];

/** The permissions, in the order they are shown. New ones are added here and by a migration. */
export const PERMISSIONS = [
  { key: 'task.read', label: 'Read task' },
  { key: 'task.create', label: 'Create task' },
  { key: 'task.edit', label: 'Edit task' },
  { key: 'task.delete', label: 'Delete task' },
  { key: 'member.read', label: 'View members' },
  { key: 'member.edit', label: 'Change member roles' },
  { key: 'team.read', label: 'View teams' },
  { key: 'team.edit', label: 'Manage teams' },
  { key: 'game.edit', label: 'Manage game scoring' },
  { key: 'member.message', label: 'Message members' },
  { key: 'home.edit', label: 'Edit Home boxes' },
  { key: 'site.edit', label: 'Manage website' },
  { key: 'task.edit.any', label: "Edit anyone's task" },
  { key: 'task.delete.any', label: "Delete anyone's task" },
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

/**
 * Which role starts with which permission. Admins and editors change and
 * delete anyone's task; contributors add tasks and change and delete their
 * own; reviewers and viewers only read them (Dane, 2026-11-26, WC-248). Every member views the member list; only an admin changes roles
 * (Dane, 2026-10-29: "Only admins will get edit/delete functionality under
 * the Actions column. Other members get view functionality"). Every member
 * views the teams; admins and editors manage them (Dane, 2026-10-30, "B").
 * Only an admin manages the game's scoring rules (core/game.ts,
 * `changeScoringRule`). Every member messages members (Dane, 2026-11-01,
 * "B", on the Messaging section of Your profile; core/messages.ts). Only
 * an admin changes the words in Home's boxes (core/homeBoxes.ts), and only an
 * admin manages the website's pages (core/website.ts).
 */
export const STARTING_ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  admin: ['task.read', 'task.create', 'task.edit', 'task.delete', 'member.read', 'member.edit', 'team.read', 'team.edit', 'game.edit', 'member.message', 'home.edit', 'site.edit', 'task.edit.any', 'task.delete.any'],
  editor: ['task.read', 'task.create', 'task.edit', 'task.delete', 'member.read', 'team.read', 'team.edit', 'member.message', 'task.edit.any', 'task.delete.any'],
  contributor: ['task.read', 'task.create', 'task.edit', 'member.read', 'team.read', 'member.message', 'task.delete'],
  reviewer: ['task.read', 'member.read', 'team.read', 'member.message'],
  viewer: ['task.read', 'member.read', 'team.read', 'member.message'],
};

/** A member with no role recorded: what every member was before roles existed. */
export const DEFAULT_ROLE: RoleKey = 'contributor';

export function isRole(value: unknown): value is RoleKey {
  return ROLES.some((r) => r.key === value);
}

/** What a role may do, from the starting grants unless the client read others from the database. */
export function memberPermissions(
  role: RoleKey,
  grants: Readonly<Record<string, readonly string[]>> = STARTING_ROLE_PERMISSIONS,
): string[] {
  return [...(grants[role] ?? [])];
}

/** Does the role have the permission? From the starting grants unless the client read others from the database. */
export function mayDo(
  role: RoleKey | null | undefined,
  permission: PermissionKey,
  grants: Readonly<Record<string, readonly string[]>> = STARTING_ROLE_PERMISSIONS,
): boolean {
  return role != null && (grants[role]?.includes(permission) ?? false);
}

/**
 * The buttons in a row of the member table, each with the permission it
 * needs. Adding and removing members is left out for now (Dane, 2026-10-29,
 * option "A"): members join by signing in.
 */
export const MEMBER_ACTIONS = [
  { key: 'change-role', label: 'Change role', permission: 'member.edit' },
  { key: 'message', label: 'Message', permission: 'member.message' },
  // Live chat (core/chat.ts) rides on the same permission as messaging: both
  // are one member talking to another, and every role has it (Dane,
  // 2026-11-12: "Any two members, for now"). The database's `start_chat`
  // lets any signed-in member start one.
  { key: 'chat', label: 'Chat', permission: 'member.message' },
] as const satisfies readonly { key: string; label: string; permission: PermissionKey }[];
export type MemberActionKey = (typeof MEMBER_ACTIONS)[number]['key'];

/** The member-table buttons the role may use, in the order they are shown. */
export function memberActions(
  role: RoleKey | null | undefined,
  grants: Readonly<Record<string, readonly string[]>> = STARTING_ROLE_PERMISSIONS,
): MemberActionKey[] {
  return MEMBER_ACTIONS.filter((a) => mayDo(role, a.permission, grants)).map((a) => a.key);
}

/** Only an admin changes roles. */
export function mayManageMembers(role: RoleKey | null | undefined): boolean {
  return role === 'admin';
}

/** Only an admin opens the Admin area: the header's Admin link and the `/admin` page share this rule. */
export function mayOpenAdmin(role: RoleKey | null | undefined): boolean {
  return role === 'admin';
}

/**
 * Only an admin sees members' email addresses and how they sign in, on the
 * Members page (WC-260). The database's `list_member_emails` refuses
 * everyone else with the same rule, so the page and the database agree.
 */
export function maySeeMemberEmails(role: RoleKey | null | undefined): boolean {
  return role === 'admin';
}

/** The sign-in providers' names as shown, in the order they are listed. */
const SIGN_IN_NAMES: Record<string, string> = { google: 'Google', email: 'Email' };

/**
 * How a member signs in, in words: "Google", "Email", "Google and email".
 * A provider not named above shows by its own name; none at all says so.
 */
export function signInMethodLabel(providers: readonly string[]): string {
  const known = Object.keys(SIGN_IN_NAMES);
  const unique = [...new Set(providers.map((p) => p.trim().toLowerCase()).filter(Boolean))].sort(
    (a, b) => (known.indexOf(a) + 1 || known.length + 1) - (known.indexOf(b) + 1 || known.length + 1) || a.localeCompare(b),
  );
  if (!unique.length) return 'Unknown';
  const words = unique.map((p, i) => {
    const name = SIGN_IN_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
    return i === 0 ? name : name.toLowerCase();
  });
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** What core needs from storage for members' roles. */
export interface MemberRoleStore {
  /** The member's recorded role, or null if none is recorded. */
  roleOf(memberId: string): Promise<string | null>;
  /** How many members are admins. */
  adminCount(): Promise<number>;
  /** Record the member's role, making the row if needed. Returns the role now recorded. */
  setRole(memberId: string, role: RoleKey, tool: string): Promise<string | null>;
}

/** The member's role: their recorded one, or a contributor if none is. */
export async function roleOf(store: MemberRoleStore, memberId: string): Promise<RoleKey> {
  const role = await store.roleOf(memberId);
  return isRole(role) ? role : DEFAULT_ROLE;
}

/**
 * `actorId` gives `memberId` the role `role`, on behalf of `tool`. Refused
 * unless the actor is an admin, the role is one of WaveCenter's, and the
 * change would not leave WaveCenter without an admin. Throws if what comes
 * back is not what was asked for, so a failed save is never reported as saved.
 * When the role saved differs from the one before, the database scores it for
 * whoever is signed in, the admin who changed it (`changed_a_member_s_role`,
 * supabase/migrations/20261102133000_score_changed_a_member_s_role.sql).
 */
export async function setMemberRole(
  store: MemberRoleStore,
  change: { actorId: string; memberId: string; role: string },
  tool: string,
): Promise<RoleKey> {
  const named = requireTool(tool);
  if (!isRole(change.role)) {
    throw new CoreError(`"${String(change.role)}" is not one of WaveCenter's roles. Pick one from the list.`);
  }
  if (!mayManageMembers(await roleOf(store, change.actorId))) {
    throw new CoreError("Only an admin can change a member's role.");
  }
  const current = await roleOf(store, change.memberId);
  if (current === 'admin' && change.role !== 'admin' && (await store.adminCount()) <= 1) {
    throw new CoreError('This is the last admin, so their role cannot change. Make another member an admin first.');
  }
  const saved = await store.setRole(change.memberId, change.role, named);
  if (saved !== change.role) throw new CoreError('The role did not save. Nothing changed; try again.');
  return change.role;
}
