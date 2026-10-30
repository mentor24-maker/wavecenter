import Link from "next/link";
import { redirect } from "next/navigation";
import { SCORING_TRIGGERS, isWired, mayManageScoring, type ScoringRule } from "../../../core/game.ts";
import { ROLES } from "../../../core/members.ts";
import { supabaseScoringRuleStore } from "../../lib/engagementStore";
import { headerName } from "../../lib/memberProfileStore";
import { myRole, readRolesAndPermissions } from "../../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import SiteHeader from "../../SiteHeader";
import RuleEditor from "./RuleEditor";

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Game management: every action that earns points, each with its name,
 * description, criteria and points to change, and the function, database
 * trigger and test that make it fire (core/game.ts SCORING_TRIGGERS). A
 * change counts from the very next engagement. Below the list, a form adds a
 * new action, which stays inactive until an agent wires it in.
 *
 * Only a role with "Manage game scoring" (admin) sees the forms; anyone else
 * gets a plain message. The database refuses them too.
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
          <h1>Game management</h1>
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

  if (role.error !== null || lists.error !== null) {
    return (
      <>
        <SiteHeader name={name} />
        <main>
          <h1>Game management</h1>
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
        <SiteHeader name={name} />
        <main>
          <h1>Game management</h1>
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
      <SiteHeader name={name} />
      <main>
        <h1>Game management</h1>
        <p className="lede">
          Set what each action is worth. A change counts from the very next time someone does it; points already
          earned keep their value.
        </p>
        <p><Link href="/game">← Back to the Game page</Link></p>

        <div className="panel">
          <h2>Actions that earn points</h2>
          <RuleList rules={rules} />

          <h2>Add a new action</h2>
          <p className="note">
            A new action is listed straight away but is not active: nothing in WaveCenter records it yet, so it earns
            nothing. An agent wires it to a function, a database trigger and a test; ask for that as a task.
          </p>
          <RuleEditor />
        </div>
      </main>
    </>
  );
}

function RuleList({ rules }: { rules: Read<ScoringRule[]> }) {
  if (rules.error !== null) {
    return <p className="error" role="alert">The scoring rules could not be loaded: {rules.error}. Try reloading the page.</p>;
  }
  if (!rules.value.length) {
    return (
      <p className="error" role="alert">
        No scoring rules are set up in the database yet, so there is nothing to manage. The game-layer migration has not
        been applied.
      </p>
    );
  }
  return (
    <ul className="rules">
      {rules.value.map((r) => (
        <li key={r.kind} className="rule">
          <h3>
            {r.name} <span className="note">({r.kind})</span>
            {!isWired(r.kind) && <span className="badge"> Not active yet</span>}
          </h3>
          <Trigger kind={r.kind} />
          <RuleEditor rule={r} />
        </li>
      ))}
    </ul>
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
