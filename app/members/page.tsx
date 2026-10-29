import { redirect } from "next/navigation";
import { AVATARS } from "../../core/profiles.ts";
import { mayManageMembers, ROLES, type RoleKey } from "../../core/members.ts";
import { listMembers, myRole, readRolesAndPermissions, type MemberRow, type RolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import RolePicker from "./RolePicker";

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
 * Members: for an admin, every member with their role and a picker to change
 * it, and below it which role may do what (core/members.ts). Each member is
 * shown only as their profile allows other members to see them: their avatar,
 * and their name if their profile is public. A member who is not an admin
 * sees a plain message instead of an empty table. Signed-out visitors are
 * sent to sign in.
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

  const role = await read(() => myRole(supabase, user.id));
  const admin = role.error === null && mayManageMembers(role.value);
  const email = user.email ?? "you";

  if (!admin) {
    return (
      <>
        <SiteHeader email={email} />
        <main>
          <h1>Members</h1>
          {role.error !== null ? (
            <p className="error" role="alert">Your role could not be loaded: {role.error}. Try reloading the page.</p>
          ) : (
            <p className="note" role="status">
              Only an admin can manage members. Your role is <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>.
            </p>
          )}
        </main>
      </>
    );
  }

  const [members, lists] = await Promise.all([read(() => listMembers(supabase)), read(() => readRolesAndPermissions(supabase))]);

  return (
    <>
      <SiteHeader email={email} admin />
      <main>
        <h1>Members</h1>
        <p className="lede">Everyone in WaveCenter and their role. A change saves as soon as you pick it.</p>
        <p className="note">
          Roles and permissions are recorded but do not change what anyone may do on tasks yet: every member still
          reads every task and changes only their own.
        </p>

        <div className="panel">
          <h2>Members</h2>
          <MemberTable members={members} me={user.id} />

          <h2>Roles and permissions</h2>
          <PermissionTable lists={lists} />
        </div>
      </main>
    </>
  );
}

function MemberTable({ members, me }: { members: Read<MemberRow[]>; me: string }) {
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
      <table className="game members">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Joined</th>
            <th scope="col">Role</th>
          </tr>
        </thead>
        <tbody>
          {members.value.map((m) => {
            const name = m.displayName ?? "Anonymous member";
            const symbol = AVATARS.find((a) => a.id === m.avatar)?.symbol ?? "👤";
            return (
              <tr key={m.memberId}>
                <td>
                  <span aria-hidden="true">{symbol}</span> {name}
                  {m.memberId === me && <span className="note"> (you)</span>}
                </td>
                <td className="note">{DAY.format(new Date(m.joinedAt))}</td>
                <td>
                  <RolePicker memberId={m.memberId} initial={m.role as RoleKey} label={m.memberId === me ? "you" : name} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
