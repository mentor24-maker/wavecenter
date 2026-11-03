import Link from "next/link";
import { redirect } from "next/navigation";
import { mayManageScoring } from "../../core/game.ts";
import { mayOpenAdmin, ROLES } from "../../core/members.ts";
import { headerName } from "../lib/memberProfileStore";
import { myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import RecalculatePoints from "./RecalculatePoints";

/**
 * Admin: the home for admins' tools. The first is "Recalculate action
 * points" (RecalculatePoints), the batch job that works out every action's
 * points by formula (docs/GRANULAR_SCORING_ALGORITHM.md), shown only to a
 * role with "Manage game scoring". Hiding the
 * menu link does not stop someone typing `/admin`, so the page checks the
 * role itself (core/members.ts `mayOpenAdmin`): another role is told it may
 * not open the Admin area, and a role that could not be read says so.
 * Signed-out visitors are sent to sign in.
 */
export default async function Admin() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Admin</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there is nothing to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const [name, role] = await Promise.all([
    headerName(supabase, user),
    Promise.all([myRole(supabase, user.id), readRolesAndPermissions(supabase)]).then(
      ([value, lists]) => ({ value, grants: lists.grants, error: null }),
      (err: unknown) => ({ value: null, grants: undefined, error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);
  const isAdmin = role.error === null && mayOpenAdmin(role.value);
  const mayScore = isAdmin && mayManageScoring({ role: role.value, grants: role.grants });

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} />
      <main>
        <h1>Admin</h1>
        {role.error !== null ? (
          <p className="error" role="alert">Your role could not be loaded: {role.error}. Try reloading the page.</p>
        ) : !isAdmin ? (
          <p className="note" role="status">
            Your role, <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>, may not open the Admin area.
          </p>
        ) : mayScore ? (
          <div className="panel">
            <h2>Recalculate action points</h2>
            <p className="note">
              Works out what every action on <Link href="/game/manage">Game → Manage</Link> is worth with the formula
              (1 + Effort + 2 × Value + Rarity. Farm risk is scored but not counted yet; it is kept for anti-farming work
              to come), and shows it beside what each is worth now. Nothing changes until you click “Put these live”. A new value counts
              from the next time someone does the action; points already earned keep their value. An action with no
              factor scores is left alone: score it on Game → Manage.
            </p>
            <RecalculatePoints />
          </div>
        ) : (
          <p className="note" role="status">Your role may not manage the game scoring, so there are no admin tools for you here yet.</p>
        )}
      </main>
    </>
  );
}
