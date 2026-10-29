/**
 * The app's `MemberRoleStore` (core/members.ts): how core reaches members'
 * roles. It acts through the member's session, so row-level security decides
 * what it may read (a member's own row; every row for an admin), and a change
 * goes through the database's `set_member_role`, which repeats core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import { isRole, roleOf, type MemberRoleStore, type RoleKey } from "../../core/members.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function supabaseMemberRoleStore(supabase: Client): MemberRoleStore {
  return {
    async roleOf(memberId) {
      const { data, error } = await supabase.from("member_roles").select("role").eq("member_id", memberId).maybeSingle();
      if (error) throw new Error(`The database refused to read a member's role: ${error.message}`);
      return data?.role ?? null;
    },
    async adminCount() {
      const { count, error } = await supabase.from("member_roles").select("member_id", { count: "exact", head: true }).eq("role", "admin");
      if (error) throw new Error(`The database refused to count the admins: ${error.message}`);
      return count ?? 0;
    },
    async setRole(memberId, role, tool) {
      const { data, error } = await supabase.rpc("set_member_role", { member: memberId, new_role: role, tool });
      if (error) throw new Error(`The database refused to change the role: ${error.message}`);
      return typeof data === "string" ? data : null;
    },
  };
}

/** The signed-in member's own role. Read failures throw, so a caller can say so. */
export function myRole(supabase: Client, memberId: string): Promise<RoleKey> {
  return roleOf(supabaseMemberRoleStore(supabase), memberId);
}

/** For the header: is the signed-in member an admin? A failed read counts as no, so the page still loads. */
export async function isAdmin(supabase: Client, memberId: string): Promise<boolean> {
  try {
    return (await myRole(supabase, memberId)) === "admin";
  } catch {
    return false;
  }
}

/** One row of the Members page: only what each member's profile lets other members see. */
export interface MemberRow {
  memberId: string;
  role: RoleKey;
  /** Null when their profile is private. */
  avatar: string | null;
  /** Set only when their profile is public and has a name. */
  displayName: string | null;
  joinedAt: string;
}

/** Every member, for any role with "View members" (every role today). The database refuses a signed-out caller or a role without it. */
export async function listMembers(supabase: Client): Promise<MemberRow[]> {
  const { data, error } = await supabase.rpc("list_members");
  if (error) throw new Error(`The database refused to list the members: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    memberId: r.member_id,
    role: isRole(r.role) ? r.role : "contributor",
    avatar: r.avatar,
    displayName: r.display_name,
    joinedAt: r.joined_at,
  }));
}

export interface RolesAndPermissions {
  roles: { key: string; name: string; description: string }[];
  permissions: { key: string; label: string }[];
  /** Role key → the permission keys it has. */
  grants: Record<string, string[]>;
}

/** The roles, permissions and who has what, as the database holds them. */
export async function readRolesAndPermissions(supabase: Client): Promise<RolesAndPermissions> {
  const [roles, permissions, grants] = await Promise.all([
    supabase.from("roles").select("key,name,description").order("position"),
    supabase.from("permissions").select("key,label").order("position"),
    supabase.from("role_permissions").select("role,permission"),
  ]);
  const error = roles.error ?? permissions.error ?? grants.error;
  if (error) throw new Error(`The database refused to read the roles and permissions: ${error.message}`);
  const byRole: Record<string, string[]> = {};
  for (const g of grants.data ?? []) (byRole[g.role] ??= []).push(g.permission);
  return { roles: roles.data ?? [], permissions: permissions.data ?? [], grants: byRole };
}
