import Link from "next/link";
import type { Engagement, ScoringRule } from "../../core/game.ts";
import { supabaseEngagementLedger } from "../lib/engagementStore";
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

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The Game page: how points are earned (the scoring rules), the signed-in
 * member's points total, and their latest engagements, newest first. Every
 * part that could not be read says so on its own, and an empty history says
 * why it is empty (engineering rule 7).
 */
export default async function Game() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Game</h1>
          {!supabase ? (
            <p className="error" role="alert">This copy of WaveCenter has no database settings, so there are no points to show.</p>
          ) : checkFailed ? (
            <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>
          ) : (
            <p>
              Sign in to see the points you have earned. <Link href="/sign-in">Sign in</Link>
            </p>
          )}
        </main>
      </>
    );
  }

  const ledger = supabaseEngagementLedger(supabase, user.id);
  const [rules, total, latest] = await Promise.all([
    read(() => ledger.rules()),
    read(() => ledger.total()),
    read(() => ledger.latest(LATEST)),
  ]);

  return (
    <>
      <SiteHeader email={user.email ?? "you"} />
      <main>
        <h1>Game</h1>
        <p className="lede">
          Everything you do in WaveCenter is recorded and earns points. The points are set by the rules below, never
          by the tool you used.
        </p>

        <h2>Your points</h2>
        {total.error !== null ? (
          <p className="error" role="alert">Your points total could not be loaded: {total.error}. Try reloading the page.</p>
        ) : (
          <p className="score">
            <b>{total.value.toLocaleString("en-US")}</b> {total.value === 1 ? "point" : "points"}
          </p>
        )}

        <h2>How points are earned</h2>
        <RulesTable rules={rules} />

        <h2>Your latest engagements</h2>
        <History latest={latest} rules={rules.value ?? []} />
      </main>
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
        You have not earned any points yet. <Link href="/">Make a task</Link> to earn your first.
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
