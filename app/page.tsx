import Link from "next/link";
import { mayDo, ROLES, type RoleKey } from "../core/members.ts";
import { AVATARS } from "../core/profiles.ts";
import { headerName } from "./lib/memberProfileStore";
import { listMembers, myRole, readRolesAndPermissions, type MemberRow, type RolesAndPermissions } from "./lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "./lib/supabase";
import { shownName } from "./members/memberView";
import Mission from "./Mission";
import SiteHeader from "./SiteHeader";

/** How many of the newest members Home shows. */
const LATEST_MEMBERS = 5;

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
 * Signed out: the placeholder page, which says what this is, plus a way to
 * sign in. Signed in: Home, a dashboard of boxes (Dane, 2026-10-29): About
 * WaveCenter and What is a DEO (callouts to their own pages), the tasks
 * being worked on right now, the leaderboard (a placeholder until it works),
 * and the newest members. Each box that could not be read says so on its
 * own, and an empty box says why (engineering rule 7). The task list itself
 * is at `/tasks`.
 */
export default async function Home() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && user) return <Dashboard supabase={supabase} user={user} />;

  return (
    <>
      <SiteHeader />
      <main>
        <h1>WaveCenter</h1>
        <p className="lede">The hub of the DEO movement. Coming soon.</p>
        <Mission />
        <p className="note">
          Today it is a simple to-do list. It will become a project management tool,
          then the platform the DEO builds itself with.
        </p>
        {checkFailed && (
          <p className="error" role="alert">
            {SIGN_IN_CHECK_FAILED}
          </p>
        )}
        <p>
          <Link href="/sign-in" className="button">Log in</Link>
        </p>
      </main>
    </>
  );
}

type Supabase = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

async function Dashboard({ supabase, user }: { supabase: Supabase; user: { id: string; email?: string | null } }) {
  const [name, working, role, lists] = await Promise.all([
    headerName(supabase, user),
    supabase.from("tasks").select("id, title").eq("status", "doing").order("position").order("created_at"),
    read(() => myRole(supabase, user.id)),
    read(() => readRolesAndPermissions(supabase)),
  ]);

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>Home</h1>
        <div className="dashboard">
          <section className="box level-1 callout">
            <h2>About WaveCenter</h2>
            <p>The hub of the DEO movement: what it is for and where it is going.</p>
            <p><Link href="/about">Read about WaveCenter &rarr;</Link></p>
          </section>

          <section className="box level-1 callout">
            <h2>What is a DEO</h2>
            <p>What a Decentralized Engagement Organization is.</p>
            <p><Link href="/deo">Read what a DEO is &rarr;</Link></p>
          </section>

          <section className="box level-1">
            <h2>Currently working tasks</h2>
            {working.error ? (
              <p className="error" role="alert">
                The tasks being worked on could not be loaded: {working.error.message}. Try reloading the page.
              </p>
            ) : !working.data?.length ? (
              <p className="note" role="status">
                No task is being worked on right now. Set a task to &ldquo;doing&rdquo; on <Link href="/tasks">the task list</Link> and it shows here.
              </p>
            ) : (
              <ul className="plain">
                {working.data.map((t) => (
                  <li key={t.id}><Link href={`/tasks/${t.id}`}>{t.title}</Link></li>
                ))}
              </ul>
            )}
          </section>

          <section className="box level-1">
            <h2>Leaderboard</h2>
            <p className="note" role="status">The leaderboard is coming. Until then, your own points are on the <Link href="/game">Game</Link> page.</p>
          </section>

          <section className="box level-1">
            <h2>Latest members</h2>
            <LatestMembers supabase={supabase} role={role} lists={lists} />
          </section>
        </div>
      </main>
    </>
  );
}

/**
 * The newest members, newest first, each shown only as their profile lets
 * other members see them: their avatar, and their name if their profile is
 * public. A role without "View members" gets a sentence saying so.
 */
async function LatestMembers({
  supabase,
  role,
  lists,
}: {
  supabase: Supabase;
  role: Read<RoleKey>;
  lists: Read<RolesAndPermissions>;
}) {
  if (role.error !== null) {
    return <p className="error" role="alert">Your role could not be loaded, so the members are not shown: {role.error}. Try reloading the page.</p>;
  }
  // The database's grants when they could be read; the starting ones
  // otherwise, which the database's own check repeats, so nobody sees more.
  if (!mayDo(role.value, "member.read", lists.value?.grants)) {
    return (
      <p className="note" role="status">
        Your role, <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>, may not see the list of members.
      </p>
    );
  }

  const members = await read(() => listMembers(supabase));
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
  const newest = [...members.value].sort(newestFirst).slice(0, LATEST_MEMBERS);
  return (
    <>
      <ul className="plain">
        {newest.map((m) => (
          <li key={m.memberId}>
            <span aria-hidden="true">{AVATARS.find((a) => a.id === m.avatar)?.symbol ?? "👤"}</span> {shownName(m)}{" "}
            <span className="note">joined {DAY.format(new Date(m.joinedAt))}</span>
          </li>
        ))}
      </ul>
      <p><Link href="/members">All members &rarr;</Link></p>
    </>
  );
}

function newestFirst(a: MemberRow, b: MemberRow): number {
  return a.joinedAt < b.joinedAt ? 1 : a.joinedAt > b.joinedAt ? -1 : 0;
}
