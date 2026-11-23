import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isWired, mayManageScoring, type Engagement, type ScoringPhase, type ScoringRule } from "../../core/game.ts";
import { scoreFinishedTasks } from "../../core/score.ts";
import type { Task } from "../../core/tasks.ts";
import { headerCatchUp, supabaseEngagementLedger, supabaseScoringPhaseStore } from "../lib/engagementStore";
import { finalWhen } from "../lib/scoringPhaseText";
import { readFinishedTasks } from "../lib/taskStore";
import { headerName } from "../lib/memberProfileStore";
import { headerIsAdmin, myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import ExploreDialog from "./ExploreDialog";
import GameMenu from "./GameMenu";

/** How many of the member's engagements the page lists. */
const LATEST = 50;

/** Times are shown in Mountain time, Dane's own. */
const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** A finish date, in Mountain time. */
const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  month: "short",
  day: "numeric",
  year: "numeric",
});

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The Game page (My Points in the Game menu): the signed-in member's points total, their finished tasks
 * and what those are worth, how points are earned (the scoring rules), and
 * their latest engagements, newest first. An admin also gets Manage in the Game
 * menu (./manage), where the rules change. A visitor who is not signed in is
 * sent to sign in. Every part that could not be read says so on its own, and
 * an empty list says why it is empty (engineering rule 7).
 *
 * Each section is a pod: a few summary numbers at a glance, and an Explore
 * link that opens its full table in a pop-up (ExploreDialog). A pod whose
 * section could not be read, or is empty, says so and has no Explore link.
 */
export default async function Game() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  // Signed out, with nothing gone wrong: go and sign in. A missing database
  // or a failed sign-in check is said on this page instead, not hidden by a bounce.
  if (supabase && !user && !checkFailed) redirect("/sign-in");

  if (!supabase || !user) {
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Game</h1>
          <GameMenu current="points" />
          {!supabase ? (
            <p className="error" role="alert">This copy of WaveCenter has no database settings, so there are no points to show.</p>
          ) : (
            <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>
          )}
        </main>
      </>
    );
  }

  const ledger = supabaseEngagementLedger(supabase, user.id);
  const [name, isAdmin, rules, total, latest, finished, role, lists, catchUp, phase] = await Promise.all([
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
    read(() => ledger.rules()),
    read(() => ledger.total()),
    read(() => ledger.latest(LATEST)),
    read(() => readFinishedTasks(supabase, user.id)),
    read(() => myRole(supabase, user.id)),
    read(() => readRolesAndPermissions(supabase)),
    headerCatchUp(supabase, user.id),
    read(() => supabaseScoringPhaseStore(supabase).phase()),
  ]);
  // The menu's Manage item shows only when the role and grants were read and allow it.
  const mayManage = role.error === null && lists.error === null && mayManageScoring({ role: role.value, grants: lists.value.grants });

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={{ ...total, catchUp }} />
      <main>
        <h1>Game</h1>
        <GameMenu current="points" mayManage={mayManage} />
        <p className="lede">
          Everything you do in WaveCenter is recorded and earns points. The points are set by the rules below, never
          by the tool you used.
        </p>

        <div className="pods">
          <section className="pod pod-points" aria-labelledby="pod-points">
            <h2 id="pod-points">Your points</h2>
            {total.error !== null ? (
              <p className="error" role="alert">Your points total could not be loaded: {total.error}. Try reloading the page.</p>
            ) : (
              <p className="pod-big">
                <b>{total.value.toLocaleString("en-US")}</b> {total.value === 1 ? "point" : "points"}
              </p>
            )}
            <PhaseLine phase={phase} />
          </section>

          <FinishedTasks finished={finished} />
          <RulesTable rules={rules} />
          <History latest={latest} rules={rules.value ?? []} />
        </div>
      </main>
    </>
  );
}

/** Every member sees whether their points may still be rescored, or are final. */
function PhaseLine({ phase }: { phase: Read<ScoringPhase> }) {
  if (phase.error !== null) {
    return <p className="error" role="alert">Whether points are final could not be loaded: {phase.error}. Try reloading the page.</p>;
  }
  return phase.value.provisional ? (
    <p className="note">
      Points are <b>provisional</b>: while this DEO&apos;s values settle, an admin may rescore past points to what each action
      is worth today.
    </p>
  ) : (
    <p className="note">
      Points are <b>final</b> since {finalWhen(phase.value)}: what you have earned stays earned.
    </p>
  );
}

/** One pod: its heading, its summary, and an Explore link when it has a table. */
function Pod({ id, title, explore, children }: { id: string; title: string; explore?: ReactNode; children: ReactNode }) {
  return (
    <section className={`pod pod-${id}`} aria-labelledby={`pod-${id}`}>
      <h2 id={`pod-${id}`}>{title}</h2>
      {children}
      {explore !== undefined && <ExploreDialog title={title}>{explore}</ExploreDialog>}
    </section>
  );
}

/** A row of labelled numbers inside a pod. */
function Facts({ facts }: { facts: [label: string, value: ReactNode][] }) {
  return (
    <dl className="pod-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FinishedTasks({ finished }: { finished: Read<Task[]> }) {
  const title = "Your finished tasks";
  if (finished.error !== null) {
    return (
      <Pod id="finished" title={title}>
        <p className="error" role="alert">Your finished tasks could not be loaded: {finished.error}. Try reloading the page.</p>
      </Pod>
    );
  }
  if (!finished.value.length) {
    return (
      <Pod id="finished" title={title}>
        <p className="note">
          No finished tasks yet. Tick a task done on <Link href="/tasks">your list</Link> to earn its points.
        </p>
      </Pod>
    );
  }
  const score = scoreFinishedTasks(finished.value);
  const lastDone = finished.value.reduce<string | null>(
    (last, t) => (t.completedAt && (!last || Date.parse(t.completedAt) > Date.parse(last)) ? t.completedAt : last),
    null,
  );
  const table = (
    <table className="game compact">
      <thead>
        <tr>
          <th scope="col">Task</th>
          <th scope="col">Finished</th>
          <th scope="col" className="num">Points</th>
        </tr>
      </thead>
      <tbody>
        {finished.value.map((t) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td className="note">{t.completedAt ? DAY.format(new Date(t.completedAt)) : "Not recorded"}</td>
            <td className="num">{t.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Pod id="finished" title={title} explore={table}>
      <Facts
        facts={[
          ["Points", score.total.toLocaleString("en-US")],
          ["Finished", score.finished.toLocaleString("en-US")],
          ["Last finished", lastDone ? DAY.format(new Date(lastDone)) : "Not recorded"],
        ]}
      />
      <p className="note">The points here are the ones set on each task you have marked done.</p>
    </Pod>
  );
}

function RulesTable({ rules }: { rules: Read<ScoringRule[]> }) {
  const title = "How points are earned";
  if (rules.error !== null) {
    return (
      <Pod id="rules" title={title}>
        <p className="error" role="alert">The scoring rules could not be loaded: {rules.error}. Try reloading the page.</p>
      </Pod>
    );
  }
  if (!rules.value.length) {
    return (
      <Pod id="rules" title={title}>
        <p className="error" role="alert">No scoring rules are set up in the database yet, so nothing can earn points. The game-layer migration has not been applied.</p>
      </Pod>
    );
  }
  const active = rules.value.filter((r) => isWired(r.kind)).length;
  const table = (
    <table className="game compact">
      <thead>
        <tr>
          <th scope="col">What you do</th>
          <th scope="col">What counts</th>
          <th scope="col" className="num">Points</th>
        </tr>
      </thead>
      <tbody>
        {rules.value.map((r) => (
          <tr key={r.kind}>
            <td>
              <b>{r.name}</b>
              {r.description && <span className="note block">{r.description}</span>}
              {!isWired(r.kind) && <span className="badge block">Not active yet: nothing records this action, so it earns nothing.</span>}
            </td>
            <td className="note">{r.criteria}</td>
            <td className="num">{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Pod id="rules" title={title} explore={table}>
      <Facts
        facts={[
          ["Rules", rules.value.length.toLocaleString("en-US")],
          ["Active", active.toLocaleString("en-US")],
          ["Not active yet", (rules.value.length - active).toLocaleString("en-US")],
        ]}
      />
      <p className="note">Explore to see what each action is worth and what counts.</p>
    </Pod>
  );
}

function History({ latest, rules }: { latest: Read<Engagement[]>; rules: ScoringRule[] }) {
  const title = "Your latest engagements";
  if (latest.error !== null) {
    return (
      <Pod id="engagements" title={title}>
        <p className="error" role="alert">Your engagements could not be loaded: {latest.error}. Try reloading the page.</p>
      </Pod>
    );
  }
  if (!latest.value.length) {
    return (
      <Pod id="engagements" title={title}>
        <p className="note">
          You have not earned any points yet. <Link href="/tasks">Make a task</Link> to earn your first.
        </p>
      </Pod>
    );
  }
  const names = new Map(rules.map((r) => [r.kind, r.name]));
  // A correction a rescore added is not an action: it says what it corrected.
  const what = (e: Engagement) => (e.rescoreId ? `Rescored ${names.get(e.kind) ?? e.kind}` : names.get(e.kind) ?? e.kind);
  const earned = latest.value.reduce((sum, e) => sum + e.points, 0);
  const newest = latest.value[0];
  const table = (
    <>
      <table className="game compact">
        <thead>
          <tr>
            <th scope="col">What you did</th>
            <th scope="col">When</th>
            <th scope="col">Tool</th>
            <th scope="col" className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {latest.value.map((e) => (
            <tr key={e.id}>
              <td>{what(e)}</td>
              <td className="note">{WHEN.format(new Date(e.createdAt))}</td>
              <td className="note">{e.tool}</td>
              <td className="num">{e.points < 0 ? e.points : `+${e.points}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {latest.value.length === LATEST && <p className="note">Showing your latest {LATEST}.</p>}
    </>
  );
  return (
    <Pod id="engagements" title={title} explore={table}>
      <Facts
        facts={[
          ["Shown", latest.value.length.toLocaleString("en-US")],
          ["Points in them", earned.toLocaleString("en-US")],
        ]}
      />
      <p className="pod-latest">
        Latest: <b>{what(newest)}</b> <span className="note">{WHEN.format(new Date(newest.createdAt))}</span>
      </p>
    </Pod>
  );
}
