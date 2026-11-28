/**
 * The app's `MemberRoleStore` (core/members.ts): how core reaches members'
 * roles. It acts through the member's session, so row-level security decides
 * what it may read (a member's own row; every row for an admin), and a change
 * goes through the database's `set_member_role`, which repeats core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import { ROLES, isRole, mayOpenAdmin, newestMembers, roleOf, type MemberRoleStore, type RoleKey } from "../../core/members.ts";
import { latestMembersAccess, type SiteLatestMembers } from "../../core/website.ts";
import { SIGN_IN_CHECK_FAILED, type supabaseForRequest } from "./supabase";

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

/**
 * For the header: may the signed-in member open the Admin area? A role that
 * could not be read counts as no, so the Admin link never shows by mistake.
 */
export async function headerIsAdmin(supabase: Client, memberId: string): Promise<boolean> {
  try {
    return mayOpenAdmin(await myRole(supabase, memberId));
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

/** One member's email address and how they sign in: for an admin only. */
export interface MemberEmail {
  memberId: string;
  email: string | null;
  /** The sign-in providers on their account, as the database names them ("google", "email"). */
  providers: string[];
}

/**
 * Every member's email address and sign-in providers, keyed by member id.
 * Only an admin may (maySeeMemberEmails in core/members.ts); the database's
 * `list_member_emails` refuses anyone else, and a refusal throws so the page
 * can say so.
 */
export async function listMemberEmails(supabase: Client): Promise<Map<string, MemberEmail>> {
  const { data, error } = await supabase.rpc("list_member_emails");
  if (error) throw new Error(`The database refused to read the members' email addresses: ${error.message}`);
  return new Map(
    ((data ?? []) as any[]).map((r) => [
      r.member_id,
      { memberId: r.member_id, email: r.email ?? null, providers: Array.isArray(r.providers) ? r.providers : [] },
    ]),
  );
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

/**
 * What a website page's Latest members module draws (WC-263), read on the
 * server with the visitor's own session (never the service key, rule 3), the
 * same members Home's Latest members box shows (core newestMembers). Core's
 * latestMembersAccess decides first: a visitor who is not signed in gets
 * `signed-out` and nothing is read; a failed sign-in check says so, never
 * "Sign in"; a role without "View members" gets `not-allowed`, as on Home.
 * Any failed read is `failed` in plain words, never an empty list (rule 7);
 * the database's own words stay in the server's log.
 */
export async function readLatestMembers(
  supabase: Client | null,
  visitor: { memberId: string | null; checkFailed: boolean },
): Promise<SiteLatestMembers> {
  const signedIn = Boolean(visitor.memberId);
  let role: RoleKey | null = null;
  let grants: Record<string, string[]> | undefined;
  if (supabase && visitor.memberId && !visitor.checkFailed) {
    const [mine, lists] = await Promise.allSettled([myRole(supabase, visitor.memberId), readRolesAndPermissions(supabase)]);
    if (mine.status === "fulfilled") role = mine.value;
    else console.error("The Latest members module could not read the visitor's role:", mine.reason);
    // The database's grants when they could be read; the starting ones
    // otherwise, which the database's own check repeats, so nobody sees more.
    if (lists.status === "fulfilled") grants = lists.value.grants;
  }
  const access = latestMembersAccess({ signedIn, checkFailed: visitor.checkFailed, role, grants }, Boolean(supabase));
  switch (access) {
    case "no-database":
      return { kind: "failed", problem: "This copy of WaveCenter has no database settings, so there are no members to show." };
    case "check-failed":
      return { kind: "failed", problem: SIGN_IN_CHECK_FAILED };
    case "signed-out":
      return { kind: "signed-out" };
    case "role-failed":
      return { kind: "failed", problem: "Your role could not be loaded, so the members are not shown. Try reloading in a minute." };
    case "not-allowed":
      return { kind: "not-allowed", roleName: ROLES.find((r) => r.key === role)?.name ?? String(role) };
  }
  if (!supabase) return { kind: "signed-out" }; // never reached: no database is "no-database" above
  try {
    const members = newestMembers(await listMembers(supabase));
    return { kind: "rows", members: members.map(({ memberId, avatar, displayName, joinedAt }) => ({ memberId, avatar, displayName, joinedAt })) };
  } catch (err) {
    console.error("The Latest members module could not list the members:", err);
    return { kind: "failed", problem: "The members could not be loaded just now. Try reloading in a minute." };
  }
}
