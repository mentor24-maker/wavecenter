import { redirect } from "next/navigation";
import { ROLES, STARTING_ROLE_PERMISSIONS } from "../../core/members.ts";
import { mayManageTeams, mayViewTeams } from "../../core/teams.ts";
import { headerName } from "../lib/memberProfileStore";
import { listMembers, myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import { listTeamMembers, listTeams } from "../lib/teamStore";
import { shownName } from "../members/memberView";
import SiteHeader from "../SiteHeader";
import TeamManager, { type Candidate, type TeamView } from "./TeamManager";

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
 * Team Manager: every team with its slug, description and members (each
 * shown only as their profile lets other members see them), for any role
 * with "View teams". A role with "Manage teams" (admin and editor; Dane,
 * 2026-10-30, "B") also gets Create, Edit and Delete, and adds and removes a
 * team's members. A role that may not view teams gets a plain message
 * instead of an empty table. Signed-out visitors are sent to sign in.
 */
export default async function Teams() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Team Manager</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there are no teams to show." : SIGN_IN_CHECK_FAILED}
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
  // otherwise, which the database's own rules repeat, so nobody sees more.
  const grants = lists.value?.grants ?? STARTING_ROLE_PERMISSIONS;
  const mayView = role.error === null && mayViewTeams(role.value, grants);

  if (!mayView) {
    return (
      <>
        <SiteHeader name={name} />
        <main>
          <h1>Team Manager</h1>
          {role.error !== null ? (
            <p className="error" role="alert">Your role could not be loaded: {role.error}. Try reloading the page.</p>
          ) : (
            <p className="note" role="status">
              Your role, <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>, may not see the teams.
            </p>
          )}
        </main>
      </>
    );
  }

  // No buttons unless the grants were read: a button must never show to a role that may not use it.
  const manage = lists.value !== null && mayManageTeams(role.value, lists.value.grants);
  const [teams, links, everyone] = await Promise.all([
    read(() => listTeams(supabase)),
    read(() => listTeamMembers(supabase)),
    manage ? read(() => listMembers(supabase)) : Promise.resolve(null),
  ]);

  const loadError = teams.error ?? links.error;
  const views: TeamView[] =
    teams.value && links.value
      ? teams.value.map((t) => ({
          ...t,
          members: links.value
            .filter((l) => l.teamId === t.id)
            .map((l) => ({ memberId: l.memberId, avatar: l.avatar, name: shownName(l), you: l.memberId === user.id })),
        }))
      : [];
  const candidates: Candidate[] | null =
    everyone?.value?.map((m) => ({
      memberId: m.memberId,
      label: `${shownName(m)}${m.memberId === user.id ? " (you)" : ""} · joined ${DAY.format(new Date(m.joinedAt))}`,
    })) ?? null;

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>Team Manager</h1>
        <p className="lede">
          Every team in WaveCenter and who is on it.{" "}
          {manage ? "You can make, change and delete teams and their member lists." : "Only an admin or an editor can change the teams."}
        </p>
        {loadError !== null ? (
          <p className="error" role="alert">The teams could not be loaded: {loadError}. Try reloading the page.</p>
        ) : (
          <TeamManager
            teams={views}
            manage={manage}
            candidates={candidates}
            candidatesError={everyone?.error ?? null}
          />
        )}
      </main>
    </>
  );
}
