import Link from "next/link";
import { redirect } from "next/navigation";
import { isWired, mayManageScoring, type Engagement, type ScoringRule } from "../../core/game.ts";
import { scoreFinishedTasks } from "../../core/score.ts";
import type { Task } from "../../core/tasks.ts";
import { supabaseEngagementLedger } from "../lib/engagementStore";
import { readFinishedTasks } from "../lib/taskStore";
import { headerName } from "../lib/memberProfileStore";
import { myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";

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
 * The Game page: the signed-in member's points total, their finished tasks
 * and what those are worth, how points are earned (the scoring rules), and
 * their latest engagements, newest first. An admin also gets a link to Game
 * management (./manage), where the rules change. A visitor who is not signed in is
 * sent to sign in. Every part that could not be read says so on its own, and
 * an empty list says why it is empty (engineering rule 7).
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
  const [name, rules, total, latest, finished, role, lists] = await Promise.all([
    headerName(supabase, user),
    read(() => ledger.rules()),
    read(() => ledger.total()),
    read(() => ledger.latest(LATEST)),
    read(() => readFinishedTasks(supabase, user.id)),
    read(() => myRole(supabase, user.id)),
    read(() => readRolesAndPermissions(supabase)),
  ]);
  // The link shows only when the role and grants were read and allow it.
  const mayManage = role.error === null && lists.error === null && mayManageScoring({ role: role.value, grants: lists.value.grants });

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>Game</h1>
        <p className="lede">
          Everything you do in WaveCenter is recorded and earns points. The points are set by the rules below, never
          by the tool you used.
        </p>

        <div className="panel">
          <h2>Your points</h2>
          {total.error !== null ? (
            <p className="error" role="alert">Your points total could not be loaded: {total.error}. Try reloading the page.</p>
          ) : (
            <p className="score">
              <b>{total.value.toLocaleString("en-US")}</b> {total.value === 1 ? "point" : "points"}
            </p>
          )}

          <h2>Your finished tasks</h2>
          <FinishedTasks finished={finished} />

          <h2>How points are earned</h2>
          {mayManage && (
            <p>
              <Link href="/game/manage">Manage scoring</Link>
            </p>
          )}
          <RulesTable rules={rules} />

          <h2>Your latest engagements</h2>
          <History latest={latest} rules={rules.value ?? []} />
        </div>
      </main>
    </>
  );
}

function FinishedTasks({ finished }: { finished: Read<Task[]> }) {
  if (finished.error !== null) {
    return <p className="error" role="alert">Your finished tasks could not be loaded: {finished.error}. Try reloading the page.</p>;
  }
  if (!finished.value.length) {
    return (
      <p className="note">
        No finished tasks yet. Tick a task done on <Link href="/tasks">your list</Link> to earn its points.
      </p>
    );
  }
  const score = scoreFinishedTasks(finished.value);
  return (
    <>
      <p className="score">
        <b>{score.total.toLocaleString("en-US")}</b> {score.total === 1 ? "point" : "points"} from{" "}
        {score.finished.toLocaleString("en-US")} finished {score.finished === 1 ? "task" : "tasks"}
      </p>
      <p className="note">The points here are the ones set on each task you have marked done.</p>
      <table className="game">
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
    </>
  );
}

function RulesTable({ rules }: { rules: Read<ScoringRule[]> }) {
  if (rules.error !== null) {
    return <p className="error" role="alert">The scoring rules could not be loaded: {rules.error}. Try reloading the page.</p>;
  }
  if (!rules.value.length) {
    return <p className="error" role="alert">No scoring rules are set up in the database yet, so nothing can earn points. The game-layer migration has not been applied.</p>;
  }
  return (
    <table className="game">
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
}

function History({ latest, rules }: { latest: Read<Engagement[]>; rules: ScoringRule[] }) {
  if (latest.error !== null) {
    return <p className="error" role="alert">Your engagements could not be loaded: {latest.error}. Try reloading the page.</p>;
  }
  if (!latest.value.length) {
    return (
      <p className="note">
        You have not earned any points yet. <Link href="/tasks">Make a task</Link> to earn your first.
      </p>
    );
  }
  const names = new Map(rules.map((r) => [r.kind, r.name]));
  return (
    <>
      <table className="game">
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
              <td>{names.get(e.kind) ?? e.kind}</td>
              <td className="note">{WHEN.format(new Date(e.createdAt))}</td>
              <td className="note">{e.tool}</td>
              <td className="num">+{e.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {latest.value.length === LATEST && <p className="note">Showing your latest {LATEST}.</p>}
    </>
  );
}
