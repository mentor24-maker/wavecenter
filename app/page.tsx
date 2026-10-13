import Link from "next/link";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "./lib/supabase";
import { DEFAULT_MEMBER_SETTINGS } from "../core/agents.ts";
import { isImage } from "../core/files.ts";
import { TASK_FILES_BUCKET } from "./lib/taskFileStore";
import SiteHeader from "./SiteHeader";
import TaskList, { type ListFile } from "./tasks/TaskList";

/**
 * Signed out: the placeholder page, which says what this is, plus a way to
 * sign in. Signed in: "Your tasks", the to-do list, read through the member's
 * own session so row-level security returns only their rows. Every empty or
 * failed state says why (engineering rule 7).
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

/** How long a link to view or download an attached file works: one hour. */
const FILE_LINK_SECONDS = 60 * 60;

/**
 * Every attached file, with a short-lived signed link to it: the bucket is
 * private, so a link is the only way in, and it stops working after an hour.
 * Pictures get a link that opens them; other files a link that downloads.
 */
async function loadFiles(supabase: Supabase): Promise<{ files: ListFile[]; error: string | null }> {
  const { data: rows, error } = await supabase.from("task_files").select("id, task_id, path, name, content_type").order("created_at");
  if (error) return { files: [], error: error.message };
  if (!rows?.length) return { files: [], error: null };
  const bucket = supabase.storage.from(TASK_FILES_BUCKET);
  const images = rows.filter((r) => isImage(r.content_type));
  const others = rows.filter((r) => !isImage(r.content_type));
  const [shown, downloads] = await Promise.all([
    images.length ? bucket.createSignedUrls(images.map((r) => r.path), FILE_LINK_SECONDS) : { data: [], error: null },
    others.length ? bucket.createSignedUrls(others.map((r) => r.path), FILE_LINK_SECONDS, { download: true }) : { data: [], error: null },
  ]);
  const linkError = shown.error ?? downloads.error;
  if (linkError) return { files: [], error: linkError.message };
  const links = new Map([...(shown.data ?? []), ...(downloads.data ?? [])].map((l) => [l.path, l.signedUrl]));
  return {
    files: rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      name: r.name,
      image: isImage(r.content_type),
      url: links.get(r.path) ?? null,
    })),
    error: null,
  };
}

async function YourTasks({ supabase, email, userId }: { supabase: Supabase; email: string; userId: string }) {
  const [{ data: tasks, error }, settings, files] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, notes, status, points, parent_task_id, priority, agent_selected, agent_ticket_url, created_at")
      .order("position")
      .order("created_at"),
    supabase.from("member_settings").select("agents_on").eq("owner_id", userId).maybeSingle(),
    loadFiles(supabase),
  ]);
  // A member who has never touched the switch has no row yet: that is "off",
  // not an error. A failed read is an error, and the switch says so.
  const agents = settings.error
    ? { on: null, error: settings.error.message }
    : { on: settings.data?.agents_on ?? DEFAULT_MEMBER_SETTINGS.agentsOn, error: null };

  return (
    <>
      <SiteHeader email={email} />
      <main>
        <h1>Your tasks</h1>
        {error ? (
          <p className="error" role="alert">
            Your tasks could not be loaded: {error.message}. Nothing has been lost; try reloading the page.
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
              createdAt: t.created_at,
            }))}
            agents={agents}
            files={files}
          />
        )}
      </main>
    </>
  );
}
