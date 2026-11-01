import Link from "next/link";
import { mayDo, mayOpenAdmin, ROLES, type RoleKey } from "../core/members.ts";
import { AVATARS } from "../core/profiles.ts";
import { loadEvolution } from "./lib/evolutionReads";
import { headerName } from "./lib/memberProfileStore";
import { listMembers, myRole, readRolesAndPermissions, type MemberRow, type RolesAndPermissions } from "./lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "./lib/supabase";
import { shownName } from "./members/memberView";
import Mission from "./Mission";
import SignInForm from "./sign-in/SignInForm";
import SiteHeader from "./SiteHeader";
import Evolution from "./tasks/Evolution";

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
 * Signed out: the landing page (Dane, 2026-10-31): his water-drop picture
 * across the whole screen, the logo top left, an introduction on the left
 * and the log-in form on the right, the same form `/sign-in` shows. On a
 * phone the introduction sits above the form. Signed in: Home, a dashboard
 * of boxes (Dane, 2026-10-29): About
 * WaveCenter and What is a DEO (callouts to their own pages), the tasks
 * being worked on right now, the leaderboard (a placeholder until it works),
 * and the newest members, then Evolution across the full width (moved here
 * from the Tasks page, its pictures 50% taller: Dane, 2026-11-01). Each box that could not be read says so on its
 * own, and an empty box says why (engineering rule 7). The task list itself
 * is at `/tasks`. Home sits on the same water-drop picture, header
 * included (Dane, 2026-10-31), its boxes frosted glass with an icon each.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && user) return <Dashboard supabase={supabase} user={user} />;
  const { error } = await searchParams;

  return (
    <div className="landing">
      <header className="landing-top">
        <Link href="/" className="brand" aria-label="WaveCenter home">
          {/* The same rings and name as the bar on every other page; the picture behind the page is set in globals.css. */}
          <img className="mark" src="/brand/mark.png" alt="" width={54} height={54} />
          <span>
            Wave<b>Center</b>
          </span>
        </Link>
      </header>
      <main className="landing-body">
        <section className="landing-intro">
          <h1>The hub of the DEO movement</h1>
          <Mission />
          <p>
            Today it is a simple to-do list. It will become a project management tool,
            then the platform the DEO builds itself with.
          </p>
        </section>
        <section className="landing-form panel" aria-labelledby="log-in-heading">
          <h2 id="log-in-heading">Log in or join</h2>
          <SignInForm from="/" error={error} checkFailed={checkFailed} />
        </section>
      </main>
    </div>
  );
}

type Supabase = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

async function Dashboard({ supabase, user }: { supabase: Supabase; user: { id: string; email?: string | null } }) {
  const [name, working, role, lists, evolution] = await Promise.all([
    headerName(supabase, user),
    supabase.from("tasks").select("id, title").eq("status", "doing").order("position").order("created_at"),
    read(() => myRole(supabase, user.id)),
    read(() => readRolesAndPermissions(supabase)),
    read(() => loadEvolution(supabase)),
  ]);

  return (
    <div className="home-page">
      <SiteHeader name={name} isAdmin={role.error === null && mayOpenAdmin(role.value)} onPicture />
      <main>
        <h1>Home</h1>
        <div className="dashboard">
          <section className="box level-1 callout">
            <h2><BoxIcon name="about" />About WaveCenter</h2>
            <p>The hub of the DEO movement: what it is for and where it is going.</p>
            <p><Link href="/about">Read about WaveCenter &rarr;</Link></p>
          </section>

          <section className="box level-1 callout">
            <h2><BoxIcon name="deo" />What is a DEO</h2>
            <p>What a Decentralized Engagement Organization is.</p>
            <p><Link href="/deo">Read what a DEO is &rarr;</Link></p>
          </section>

          <section className="box level-1">
            <h2><BoxIcon name="working" />Currently working tasks</h2>
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
            <h2><BoxIcon name="leaderboard" />Leaderboard</h2>
            <p className="note" role="status">The leaderboard is coming. Until then, your own points are on the <Link href="/game">Game</Link> page.</p>
          </section>

          <section className="box level-1">
            <h2><BoxIcon name="members" />Latest members</h2>
            <LatestMembers supabase={supabase} role={role} lists={lists} />
          </section>

          <section className="box level-1 wide" id="evolution">
            <h2><BoxIcon name="evolution" />Evolution</h2>
            <p className="note">How WaveCenter looked right after each change was merged, from the first commit to today.</p>
            {evolution.error !== null || evolution.value.error ? (
              <p className="error" role="alert">
                The changes could not be loaded: {evolution.error ?? evolution.value?.error}. Nothing has been lost; try reloading the page.
              </p>
            ) : evolution.value.cards.length === 0 ? (
              <p className="note" role="status">No changes have been captured yet: the screenshot taker has not run.</p>
            ) : (
              <>
                {evolution.value.problems.map((p) => (
                  <p key={p} className="error" role="alert">{p}</p>
                ))}
                <Evolution cards={evolution.value.cards} />
              </>
            )}
          </section>
        </div>
      </main>
    </div>
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

/** The small line drawing in each Home box's heading. Decorative: the heading says it in words. */
function BoxIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <span className="box-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </svg>
    </span>
  );
}

const ICONS = {
  // A drop with a ripple under it: WaveCenter itself.
  about: (
    <>
      <path d="M12 3c2.5 3.2 4 5.6 4 7.5a4 4 0 0 1-8 0C8 8.6 9.5 6.2 12 3z" />
      <path d="M4 19c2.7-1.6 5.3-1.6 8 0s5.3 1.6 8 0" />
    </>
  ),
  // Three linked circles: an organisation with no centre.
  deo: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="19" cy="18" r="2.5" />
      <path d="M10.8 7.2 6.2 15.8M13.2 7.2l4.6 8.6M7.5 18h9" />
    </>
  ),
  // A checklist: tasks under way.
  working: (
    <>
      <path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11" />
      <path d="M11 6.5h9M11 12.5h9M11 18.5h9" />
      <circle cx="6" cy="18.5" r="1.5" />
    </>
  ),
  // A trophy.
  leaderboard: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5" />
    </>
  ),
  // Two people.
  members: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2a5 5 0 0 1 5 5.3" />
    </>
  ),
  // A strip of film: the screenshots of each change.
  evolution: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
    </>
  ),
};
