import { redirect } from "next/navigation";
import { rankLeaderboard, type LeaderboardRow } from "../../../core/leaderboard.ts";
import { headerPoints, readLeaderboard } from "../../lib/engagementStore";
import { headerName } from "../../lib/memberProfileStore";
import { headerIsAdmin } from "../../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import SiteHeader from "../../SiteHeader";
import GameMenu, { mayManageGame } from "../GameMenu";

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const n = (value: number) => value.toLocaleString("en-US");

/**
 * The Game leaderboard (WaveCenter task "Create Leaderboard"): every member,
 * ranked by Total, with their Granular, Globular, Tasks and Total scores
 * (core/leaderboard.ts says what each one is). The signed-in member's own
 * row is marked. A member whose profile is not Public shows as "Anonymous
 * member"; the database never sends their name. Names are not links yet: no
 * page shows one member's profile to another.
 *
 * It treats visitors as `/game` does: signed out goes to sign in; no database
 * settings, a failed sign-in check, a failed read and an empty board each say
 * so on the page (engineering rule 7).
 */
export default async function Leaderboard() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (supabase && !user && !checkFailed) redirect("/sign-in");

  if (!supabase || !user) {
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Game</h1>
          <GameMenu current="leaderboard" />
          {!supabase ? (
            <p className="error" role="alert">This copy of WaveCenter has no database settings, so there is no leaderboard to show.</p>
          ) : (
            <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>
          )}
        </main>
      </>
    );
  }

  const [name, isAdmin, mayManage, points, board] = await Promise.all([
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
    mayManageGame(supabase, user.id),
    headerPoints(supabase, user.id),
    read(async () => rankLeaderboard(await readLeaderboard(supabase))),
  ]);

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={points} />
      <main>
        <h1>Game</h1>
        <GameMenu current="leaderboard" mayManage={mayManage} />
        <p className="lede">
          Every member, ranked by their total points. <b>Granular</b> is the points earned for each action, the same
          number My Points shows. <b>Globular</b> is the points on the tasks they have finished. <b>Tasks</b> is how
          many tasks they have finished. <b>Total</b> is Granular plus Globular.
        </p>
        {board.error !== null ? (
          <p className="error" role="alert">The leaderboard could not be loaded: {board.error}. Try reloading the page.</p>
        ) : board.value.length === 0 ? (
          <p className="note">There is nobody on the leaderboard yet: WaveCenter has no members to rank.</p>
        ) : (
          <Board rows={board.value} />
        )}
      </main>
    </>
  );
}

function Board({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <table className="game members leaderboard">
      <caption className="sr-only">Members ranked by total points</caption>
      <thead>
        <tr>
          <th scope="col" className="num">Rank</th>
          <th scope="col">Member</th>
          <th scope="col" className="num">Granular</th>
          <th scope="col" className="num">Globular</th>
          <th scope="col" className="num">Tasks</th>
          <th scope="col" className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={row.you ? "you" : undefined} aria-current={row.you ? "true" : undefined}>
            <td className="num">{row.rank}</td>
            <td>
              <span className="leaderboard-avatar" role="img" aria-label={row.avatarLabel}>{row.avatarSymbol}</span>{" "}
              {row.named ? row.name : <i className="leaderboard-anonymous">{row.name}</i>}
              {row.you && <b className="leaderboard-you"> (you)</b>}
            </td>
            <td className="num">{n(row.granular)}</td>
            <td className="num">{n(row.globular)}</td>
            <td className="num">{n(row.tasks)}</td>
            <td className="num"><b>{n(row.total)}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
