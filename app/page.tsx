import Link from "next/link";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "./lib/supabase";
import { DEFAULT_MEMBER_SETTINGS } from "../core/agents.ts";
import { isAdmin } from "./lib/memberRoleStore";
import { loadComments, loadFiles } from "./lib/taskReads";
import SiteHeader from "./SiteHeader";
import TaskList, { type ListVote } from "./tasks/TaskList";

/**
 * Signed out: the placeholder page, which says what this is, plus a way to
 * sign in. Signed in: the to-do list with every member's tasks, open and done,
 * and every member's votes on them (Dane, 2026-10-27), read through the
 * member's own session. A member changes only their own tasks and votes on
 * any. Every empty or failed state says why (engineering rule 7).
 */
export default async function Home() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && user) return <YourTasks supabase={supabase} email={user.email ?? "you"} userId={user.id} />;

  return (
    <>
      <SiteHeader />
      <main>
        <h1>WaveCenter</h1>
        <p className="lede">The hub of the DEO movement. Coming soon.</p>
        <p>
          WaveCenter&rsquo;s mission is to build a modern alternative to the World Wide
          Web, and a platform on which other DEOs can extend that mission or develop
          new concepts. A DEO is a Decentralized Engagement Organization: one in which
          human engagement, not capital investment, is the founding resource, the
          operating fuel and the purpose.
        </p>
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
          <Link href="/sign-in" className="button">Sign in</Link>
        </p>
      </main>
    </>
  );
}

type Supabase = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

async function YourTasks({ supabase, email, userId }: { supabase: Supabase; email: string; userId: string }) {
  const [{ data: tasks, error }, settings, files, comments, votes, admin] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, notes, status, points, parent_task_id, priority, agent_selected, agent_ticket_url, owner_id, created_at")
      .order("position")
      .order("created_at"),
    supabase.from("member_settings").select("agents_on").eq("owner_id", userId).maybeSingle(),
    loadFiles(supabase),
    loadComments(supabase),
    supabase.from("task_votes").select("task_id, member_id, points, priority"),
    isAdmin(supabase, userId),
  ]);
  // A member who has never touched the switch has no row yet: that is "off",
  // not an error. A failed read is an error, and the switch says so.
  const agents = settings.error
    ? { on: null, error: settings.error.message }
    : { on: settings.data?.agents_on ?? DEFAULT_MEMBER_SETTINGS.agentsOn, error: null };

  return (
    <>
      <SiteHeader email={email} admin={admin} wide />
      <main className="wide">
        <h1>Tasks</h1>
        <p className="note">
          Every member&rsquo;s tasks. You can change your own, and vote on what any task is worth and how urgent it is.
        </p>
        {error ? (
          <p className="error" role="alert">
            The tasks could not be loaded: {error.message}. Nothing has been lost; try reloading the page.
          </p>
        ) : (
          <TaskList
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
          />
        )}
      </main>
    </>
  );
}
