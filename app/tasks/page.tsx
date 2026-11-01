import { redirect } from "next/navigation";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import { DEFAULT_MEMBER_SETTINGS } from "../../core/agents.ts";
import { headerName } from "../lib/memberProfileStore";
import { headerIsAdmin, myRole } from "../lib/memberRoleStore";
import { loadEvolution } from "../lib/evolutionReads";
import { loadComments, loadFiles } from "../lib/taskReads";
import SiteHeader from "../SiteHeader";
import Evolution from "./Evolution";
import { viewFrom, type TasksView } from "./evolutionView";
import TaskList, { type ListVote } from "./TaskList";
import ViewSwitch from "./ViewSwitch";

/**
 * Tasks: the to-do list with every member's tasks, open and done, and every
 * member's votes on them (Dane, 2026-10-27), read through the member's own
 * session. A member changes only their own tasks and votes on any. A visitor
 * who is not signed in is sent to sign in. Every empty or failed state says
 * why (engineering rule 7).
 *
 * Two views, switched at the top: the List (the default) and Evolution
 * (`/tasks?view=evolution`), a scroller of how WaveCenter looked after each
 * change merged into main (Dane, 2026-10-30).
 */
export default async function Tasks({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = viewFrom((await searchParams).view);
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  // Signed out, with nothing gone wrong: go and sign in. A missing database
  // or a failed sign-in check is said on this page instead, not hidden by a bounce.
  if (supabase && !user && !checkFailed) redirect("/sign-in");
  if (supabase && user) {
    return view === "evolution" ? <EvolutionView supabase={supabase} user={user} /> : <YourTasks supabase={supabase} user={user} />;
  }

  return (
    <>
      <SiteHeader />
      <main>
        <h1>Tasks</h1>
        <p className="error" role="alert">
          {!supabase ? "This copy of WaveCenter has no database settings, so there are no tasks to show." : SIGN_IN_CHECK_FAILED}
        </p>
      </main>
    </>
  );
}

type Supabase = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The page heading with the List | Evolution switch beside it. */
function Heading({ view }: { view: TasksView }) {
  return (
    <div className="tasks-heading">
      <h1>Tasks</h1>
      <ViewSwitch current={view} />
    </div>
  );
}

async function EvolutionView({ supabase, user }: { supabase: Supabase; user: { id: string; email?: string | null } }) {
  const [{ cards, error, problems }, name, isAdmin] = await Promise.all([
    loadEvolution(supabase),
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
  ]);
  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} />
      <main>
        <Heading view="evolution" />
        <p className="note">How WaveCenter looked right after each change was merged, from the first commit to today.</p>
        {error ? (
          <p className="error" role="alert">
            The changes could not be loaded: {error}. Nothing has been lost; try reloading the page.
          </p>
        ) : cards.length === 0 ? (
          <p className="note">No changes have been captured yet: the screenshot taker has not run.</p>
        ) : (
          <>
            {problems.map((p) => (
              <p key={p} className="error" role="alert">{p}</p>
            ))}
            <Evolution cards={cards} />
          </>
        )}
      </main>
    </>
  );
}

async function YourTasks({ supabase, user }: { supabase: Supabase; user: { id: string; email?: string | null } }) {
  const userId = user.id;
  const [{ data: tasks, error }, settings, files, comments, votes, name, role, isAdmin] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, notes, status, points, parent_task_id, priority, agent_selected, agent_ticket_url, owner_id, created_at")
      .order("position")
      .order("created_at"),
    supabase.from("member_settings").select("agents_on").eq("owner_id", userId).maybeSingle(),
    loadFiles(supabase),
    loadComments(supabase),
    supabase.from("task_votes").select("task_id, member_id, points, priority"),
    headerName(supabase, user),
    // A failed read is said on the page; until then no Approve button shows.
    myRole(supabase, userId).then(
      (role) => ({ role, error: null }),
      (err: unknown) => ({ role: null, error: err instanceof Error ? err.message : String(err) }),
    ),
    headerIsAdmin(supabase, user.id),
  ]);
  // A member who has never touched the switch has no row yet: that is "off",
  // not an error. A failed read is an error, and the switch says so.
  const agents = settings.error
    ? { on: null, error: settings.error.message }
    : { on: settings.data?.agents_on ?? DEFAULT_MEMBER_SETTINGS.agentsOn, error: null };

  // The list puts the "Launch AI Agents" switch on the heading's line, so it
  // draws the heading itself; without a list, the page does.
  const heading = <Heading view="list" />;
  const intro = (
    <p className="note">
      Every member&rsquo;s tasks. You can change your own, and vote on what any task is worth and how urgent it is.
    </p>
  );

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} />
      <main>
        {error ? (
          <>
            {heading}
            {intro}
            <p className="error" role="alert">
              The tasks could not be loaded: {error.message}. Nothing has been lost; try reloading the page.
            </p>
          </>
        ) : (
          <>
          {role.error && (
            <p className="error" role="alert">
              Your role could not be read: {role.error}. Admins&rsquo; Approve buttons are hidden until you reload the page.
            </p>
          )}
          <TaskList
            heading={heading}
            intro={intro}
            tasks={(tasks ?? []).map((t) => ({
              id: t.id,
              title: t.title,
              notes: t.notes,
              status: t.status,
              points: t.points ?? 0,
              parentTaskId: t.parent_task_id,
              priority: t.priority,
              agentSelected: t.agent_selected,
              agentTicketUrl: t.agent_ticket_url,
              ownerId: t.owner_id,
              createdAt: t.created_at,
            }))}
            agents={agents}
            files={files}
            comments={comments}
            votes={
              votes.error
                ? { votes: [], error: votes.error.message }
                : {
                    votes: (votes.data ?? []).map(
                      (v): ListVote => ({ taskId: v.task_id, memberId: v.member_id, points: v.points, priority: v.priority }),
                    ),
                    error: null,
                  }
            }
            userId={userId}
            admin={role.role === "admin"}
          />
          </>
        )}
      </main>
    </>
  );
}
