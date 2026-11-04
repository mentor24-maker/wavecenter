import Link from "next/link";
import { redirect } from "next/navigation";
import { mayManageScoring } from "../../core/game.ts";
import { mayOpenAdmin, ROLES } from "../../core/members.ts";
import { RATING_MODELS, RATING_RUN_MAX_TASKS } from "../../core/aiTaskRater.ts";
import { missingRatingSettings } from "../lib/aiTaskRating";
import { headerPoints, supabaseScoringPhaseStore } from "../lib/engagementStore";
import { headerName } from "../lib/memberProfileStore";
import { myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import FormulaExplained from "./FormulaExplained";
import RateTasks from "./RateTasks";
import RecalculatePoints from "./RecalculatePoints";
import RescorePastPoints from "./RescorePastPoints";
import ScoringPhase from "./ScoringPhase";

/**
 * Admin: the home for admins' tools. The first is "Recalculate action
 * points" (RecalculatePoints), the batch job that works out every action's
 * points by formula (docs/GRANULAR_SCORING_ALGORITHM.md), shown only to a
 * role with "Manage game scoring". Hiding the
 * menu link does not stop someone typing `/admin`, so the page checks the
 * role itself (core/members.ts `mayOpenAdmin`): another role is told it may
 * not open the Admin area, and a role that could not be read says so.
 * Under it, "Rescore past points" (RescorePastPoints) brings points already
 * earned to today's values, only while scoring is provisional, and
 * "Scoring phase" (ScoringPhase) says whether it still is, with the one-way
 * switch that makes points final. Last, "AI task ratings" (RateTasks) asks
 * the AI to rate the open tasks that need it (docs/GLOBULAR_SCORING_ALGORITHM.md).
 * Signed-out visitors are sent to sign in.
 */

// The AI rating run waits on the AI service; give its server action room
// (a standard Next.js setting, ignored by hosts that have no time limit).
export const maxDuration = 300;
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

  const [name, points, role, phase] = await Promise.all([
    headerName(supabase, user),
    headerPoints(supabase, user.id),
    Promise.all([myRole(supabase, user.id), readRolesAndPermissions(supabase)]).then(
      ([value, lists]) => ({ value, grants: lists.grants, error: null }),
      (err: unknown) => ({ value: null, grants: undefined, error: err instanceof Error ? err.message : String(err) }),
    ),
    // Could not be read: the section says why rather than guess (rule 7).
    supabaseScoringPhaseStore(supabase).phase().then(
      (value) => ({ value, error: null }),
      (err: unknown) => ({ value: null, error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);
  const isAdmin = role.error === null && mayOpenAdmin(role.value);
  const mayScore = isAdmin && mayManageScoring({ role: role.value, grants: role.grants });

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={points} />
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
            <FormulaExplained />
            <RecalculatePoints />

            <h2>Rescore past points</h2>
            <p className="note">
              While this DEO&apos;s scoring is provisional, brings points already earned to what each action is worth
              today. Nothing already in anyone&apos;s history is changed: for each member and action whose credit
              changes, one correction is added (it can take points away when a value went down). Preview first; nothing
              is saved until you click “Rescore these”. Running it again straight after changes nothing.
            </p>
            <RescorePastPoints provisional={phase.value?.provisional ?? null} provisionalError={phase.error} me={user.id} />

            <h2>Scoring phase</h2>
            <p className="note">
              While scoring is provisional, an admin can rescore past points as the values settle. Once they have, make
              the points final: from then on nobody can rescore history, so members can trust that points they have earned
              stay earned. It is one-way.
            </p>
            <ScoringPhase phase={phase.value} phaseError={phase.error} me={user.id} />

            <h2>AI task ratings</h2>
            <p className="note">
              Asks the AI to rate each open task on scope, difficulty, relevance and demand, 1 to 5, with a reason for
              every rating. Two models ({RATING_MODELS.join(" and ")}) rate each task separately; WaveCenter averages
              them and works out the task&apos;s AI score, 1 to 50, with the formula S × D × (R + M) ÷ 5. The AI reads the
              task&apos;s title, details, priority, parent, sub-tasks and file names, never its points or anyone&apos;s
              votes. It rates tasks with no rating yet, then tasks changed since their last rating, at most{" "}
              {RATING_RUN_MAX_TASKS} per click; done tasks are never rated, because their points are locked. Every
              rating is kept with its reasons, and nothing changes a task&apos;s points yet.
            </p>
            <RateTasks missing={missingRatingSettings()} />
          </div>
        ) : (
          <p className="note" role="status">Your role may not manage the game scoring, so there are no admin tools for you here yet.</p>
        )}
      </main>
    </>
  );
}
