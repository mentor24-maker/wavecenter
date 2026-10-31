/**
 * Members' roles and what each role may do (Dane, 2026-10-28: "a 'roles'
 * table with … admin, editor, contributor, reviewer, viewer, a 'permissions'
 * table that will be expandable but starting with read task, create task,
 * edit task, delete task"). On 2026-10-29 he chose the first slice: roles and
 * permissions are stored and shown, and an admin changes members' roles.
 *
 * The task permissions are recorded, not yet enforced: what a member may do
 * on tasks is still decided by core/tasks.ts and the tasks row-level security
 * (every member reads every task and changes only their own). A later ticket
 * makes them count. The member permissions do count: `member.read` decides
 * who may see the member list (the database's `list_members` asks it too),
 * `member.edit` who gets the role picker in each row, and `member.message`
 * who gets the Message button (the database's `send_message` asks it too).
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
  { key: 'member.message', label: 'Message members' },
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

/**
 * Which role starts with which permission. Contributors edit only their own
 * tasks. Every member views the member list; only an admin changes roles
 * (Dane, 2026-10-29: "Only admins will get edit/delete functionality under
 * the Actions column. Other members get view functionality"). Only an admin
 * messages members to start (core/messages.ts).
 */
export const STARTING_ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  admin: ['task.read', 'task.create', 'task.edit', 'task.delete', 'member.read', 'member.edit', 'member.message'],
  editor: ['task.read', 'task.create', 'task.edit', 'task.delete', 'member.read'],
  contributor: ['task.read', 'task.create', 'task.edit', 'member.read'],
  reviewer: ['task.read', 'member.read'],
  viewer: ['task.read', 'member.read'],
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
