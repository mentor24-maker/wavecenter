import Link from "next/link";
import { redirect } from "next/navigation";
import { SCORING_TRIGGERS, isWired, mayManageScoring, type ScoringRule } from "../../../core/game.ts";
import { ROLES, mayOpenAdmin } from "../../../core/members.ts";
import { supabaseScoringRuleStore } from "../../lib/engagementStore";
import { headerName } from "../../lib/memberProfileStore";
import { myRole, readRolesAndPermissions } from "../../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import SiteHeader from "../../SiteHeader";
import GameMenu from "../GameMenu";
import { NewRuleRow, RuleRow } from "./RuleTable";

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Game management: one table, a row per action that earns points. Its name,
 * points, description and criteria are edited in place (RuleTable), and each
 * row folds out the function, database trigger and test that make it fire
 * (core/game.ts SCORING_TRIGGERS). A change counts from the very next
 * engagement. The table's last row adds a new action, which stays inactive
 * until an agent wires it in.
 *
 * It sits under the Game menu (Manage). Only a role with "Manage game
 * scoring" (admin) sees the table, and only they see Manage in the menu;
 * anyone else who opens the address gets a plain message. The database
 * refuses them too.
 */
export default async function ManageGame() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Game</h1>
          <GameMenu current="manage" />
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there are no scoring rules to manage." : SIGN_IN_CHECK_FAILED}
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

  // The header's Admin item: shown only when the role was read and is an admin's.
  const isAdmin = role.error === null && mayOpenAdmin(role.value);

  if (role.error !== null || lists.error !== null) {
    return (
      <>
        <SiteHeader name={name} isAdmin={isAdmin} />
        <main>
          <h1>Game</h1>
          <GameMenu current="manage" />
          <p className="error" role="alert">
            Your role could not be checked, so the scoring rules are not shown: {role.error ?? lists.error}. Try reloading the page.
          </p>
        </main>
      </>
    );
  }

  if (!mayManageScoring({ role: role.value, grants: lists.value.grants })) {
    return (
      <>
        <SiteHeader name={name} isAdmin={isAdmin} />
        <main>
          <h1>Game</h1>
          <GameMenu current="manage" />
          <p className="note" role="status">
            Your role, <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>, may not manage the game
            scoring. Only an admin may. You can see how points are earned on the <Link href="/game">Game page</Link>.
          </p>
        </main>
      </>
    );
  }

  const rules = await read(() => supabaseScoringRuleStore(supabase).rules());

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} />
      <main>
        <h1>Game</h1>
        <GameMenu current="manage" mayManage />
        <p className="lede">
          Game management: set what each action is worth. A change counts from the very next time someone does it; points already
          earned keep their value.
        </p>

        <div className="panel">
          <h2>Actions that earn points</h2>
          <p className="note">
            Click a name, points, description or what counts to change it; Enter or clicking away saves it, Escape puts it
            back. Factors are the four scores the formula on the <Link href="/admin">Admin page</Link> works points out from
            (Effort, Value, Rarity, Farm risk); choosing the fourth saves them, and they change no points until an admin
            puts the recalculation live there. &ldquo;why&rdquo; beside a factor opens the one-sentence reason for that score, to
            write or change (faint means none is written yet). The expand button opens the text in a large box. The last row adds a new action: it is listed straight
            away but is not active, because nothing in WaveCenter records it yet, so it earns nothing. An agent wires it
            to a function, a database trigger and a test; ask for that as a task.
          </p>
          <RuleTable rules={rules} />
        </div>
      </main>
    </>
  );
}

function RuleTable({ rules }: { rules: Read<ScoringRule[]> }) {
  return (
    <div className="rule-table-wrap">
      <table className="game rule-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col">Points</th>
            <th scope="col" title="Effort, Value, Rarity, Farm risk: the formula's four factors">Factors</th>
            <th scope="col">Description</th>
            <th scope="col">What counts</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rules.error !== null ? (
            <tr>
              <td colSpan={7}>
                <p className="error" role="alert">The scoring rules could not be loaded: {rules.error}. Try reloading the page.</p>
              </td>
            </tr>
          ) : !rules.value.length ? (
            <tr>
              <td colSpan={7}>
                <p className="error" role="alert">
                  No scoring rules are set up in the database yet, so there is nothing to manage. The game-layer migration
                  has not been applied.
                </p>
              </td>
            </tr>
          ) : (
            rules.value.map((r) => <RuleRow key={r.kind} rule={r} active={isWired(r.kind)} detail={<Trigger kind={r.kind} />} />)
          )}
          <NewRuleRow />
        </tbody>
      </table>
    </div>
  );
}

function Trigger({ kind }: { kind: string }) {
  if (!isWired(kind)) {
    return (
      <p className="note">
        Nothing in WaveCenter records this action yet, so it earns nothing. It becomes active once an agent wires it to
        a function, a database trigger and a test.
      </p>
    );
  }
  const t = SCORING_TRIGGERS[kind];
  return (
    <dl className="trigger">
      <dt>Triggered by</dt>
      <dd><code>{t.fn}</code> in <code>{t.file}</code>, recorded by the database's <code>{t.database}</code></dd>
      <dt>Proved by</dt>
      <dd>the test “{t.test}” in <code>{t.testFile}</code></dd>
    </dl>
  );
}
