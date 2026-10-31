import { redirect } from "next/navigation";
import { STARTING_ROLE_PERMISSIONS, mayDo, memberActions, ROLES } from "../../core/members.ts";
import { headerName } from "../lib/memberProfileStore";
import { listMembers, myRole, readRolesAndPermissions, type MemberRow, type RolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import MemberTable from "./MemberTable";

/** Join dates are shown in Mountain time, Dane's own. */
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Members: every member with their role, a filter row and sortable headings,
 * and below it which role may do what (core/members.ts). Any role with
 * "View members" sees the table; the buttons in its Actions column are the
 * ones the viewer's role may use (memberActions), which today means an admin
 * changing roles and messaging members. Each member is shown only as their profile allows other
 * members to see them: their avatar, and their name if their profile is
 * public. A role that may not view members gets a plain message instead of an
 * empty table. Signed-out visitors are sent to sign in.
 */
export default async function Members() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Members</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there are no members to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const [role, lists, name] = await Promise.all([
    read(() => myRole(supabase, user.id)),
    read(() => readRolesAndPermissions(supabase)),
    headerName(supabase, user),
  ]);
  // The database's grants when they could be read; the starting ones
  // otherwise, which the database's own check repeats, so nobody sees more.
  const grants = lists.value?.grants ?? STARTING_ROLE_PERMISSIONS;
  const mayView = role.error === null && mayDo(role.value, "member.read", grants);

  if (!mayView) {
    return (
      <>
        <SiteHeader name={name} />
        <main>
          <h1>Members</h1>
          {role.error !== null ? (
            <p className="error" role="alert">Your role could not be loaded: {role.error}. Try reloading the page.</p>
          ) : (
            <p className="note" role="status">
              Your role, <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>, may not see the list of members.
            </p>
          )}
        </main>
      </>
    );
  }

  // No buttons unless the grants were read: a button must never show to a role that may not use it.
  const actions = lists.value ? memberActions(role.value, lists.value.grants) : [];
  const members = await read(() => listMembers(supabase));

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>Members</h1>
        <p className="lede">
          Everyone in WaveCenter and their role.{" "}
          {actions.includes("change-role") ? "A role change saves as soon as you pick it." : "Only an admin can change a role."}
          {actions.includes("message") && " The envelope writes to a member: the message is saved in WaveCenter and emailed to them."}
        </p>
        <p className="note">
          Task permissions are recorded but do not change what anyone may do on tasks yet: every member still reads
          every task and changes only their own.
        </p>

        <div className="panel">
          <h2>Members</h2>
          <MemberList members={members} me={user.id} actions={actions} />

          <h2>Roles and permissions</h2>
          <PermissionTable lists={lists} />
        </div>
      </main>
    </>
  );
}

function MemberList({ members, me, actions }: { members: Read<MemberRow[]>; me: string; actions: ReturnType<typeof memberActions> }) {
  if (members.error !== null) {
    return <p className="error" role="alert">The members could not be loaded: {members.error}. Try reloading the page.</p>;
  }
  if (!members.value.length) {
    return (
      <p className="error" role="alert">
        No members came back, not even you. The members list could not be read; try reloading the page.
      </p>
    );
  }
  return (
    <>
      <p className="note">
        Members show only what their profile lets others see: their avatar, and their name if their profile is public.
      </p>
      <MemberTable members={members.value.map((m) => ({ ...m, joinedLabel: DAY.format(new Date(m.joinedAt)) }))} me={me} actions={actions} />
    </>
  );
}

function PermissionTable({ lists }: { lists: Read<RolesAndPermissions> }) {
  if (lists.error !== null) {
    return <p className="error" role="alert">The roles and permissions could not be loaded: {lists.error}. Try reloading the page.</p>;
  }
  const { roles, permissions, grants } = lists.value;
  if (!roles.length || !permissions.length) {
    return (
      <p className="error" role="alert">
        No roles or permissions are set up in the database yet. The roles migration has not been applied.
      </p>
    );
  }
  return (
    <table className="game grants">
      <thead>
        <tr>
          <th scope="col">Role</th>
          {permissions.map((p) => (
            <th key={p.key} scope="col" className="num">{p.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.key}>
            <td>
              <b>{r.name}</b>
              <span className="note block">{r.description}</span>
            </td>
            {permissions.map((p) => {
              const has = grants[r.key]?.includes(p.key) ?? false;
              return (
                <td key={p.key} className="num">
                  <span aria-hidden="true">{has ? "✓" : "—"}</span>
                  <span className="sr-only">{has ? "Yes" : "No"}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
