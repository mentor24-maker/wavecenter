import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import type { TaskStatus } from "../../../core/tasks.ts";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import { loadComments, loadFiles } from "../../lib/taskReads";
import { fromRow } from "../../lib/taskStore";
import SiteHeader from "../../SiteHeader";
import { fullDate, PRIORITY_LABEL } from "../listView.ts";
import TaskDiscussion from "./TaskDiscussion";

const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", doing: "Doing", done: "Done" };

/** A task id is a UUID; anything else cannot be a task, so it is not asked for. */
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One task on its own page: everything WaveCenter knows about it, and its
 * Discussion, closed until clicked. Read through the signed-in member's own
 * session, so row-level security decides what comes back: every member may
 * read every task (Dane, 2026-10-27), and comments only their own. Nothing is
 * edited here; editing stays on the list. A visitor who is not signed in is
 * sent to sign in, and every missing or failed part says why (rule 7).
 */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && !user && !checkFailed) redirect("/sign-in");

  if (!supabase || !user) {
    return (
      <Shell>
        <p className="error" role="alert">
          {!supabase ? "This copy of WaveCenter has no database settings, so there is no task to show." : SIGN_IN_CHECK_FAILED}
        </p>
      </Shell>
    );
  }

  const email = user.email ?? "you";
  const read = TASK_ID.test(id) ? await supabase.from("tasks").select().eq("id", id).maybeSingle() : { data: null, error: null };
  if (read.error) {
    return (
      <Shell email={email}>
        <p className="error" role="alert">
          This task could not be loaded: {read.error.message}. Nothing has been lost; try reloading the page.
        </p>
      </Shell>
    );
  }
  if (!read.data) {
    return (
      <Shell email={email}>
        <p className="error" role="alert">This task was not found. It may have been deleted, or the link may be wrong.</p>
      </Shell>
    );
  }

  const task = fromRow(read.data);
  const mine = task.ownerId === user.id;
  const [parent, subTasks, files, comments] = await Promise.all([
    task.parentTaskId
      ? supabase.from("tasks").select("id, title").eq("id", task.parentTaskId).maybeSingle()
      : Promise.resolve(null),
    supabase.from("tasks").select("id, title, status").eq("parent_task_id", task.id).order("position").order("created_at"),
    loadFiles(supabase, task.id),
    mine ? loadComments(supabase, task.id) : Promise.resolve(null),
  ]);
  const done = task.status === "done";
  // A comment's files show in its Discussion, not in the task's own list.
  const taskFiles = files.files.filter((f) => !f.commentId);
  const commentFiles = files.files.filter((f) => f.commentId);

  return (
    <Shell email={email} title={task.title}>
      <dl className="task-facts box">
        <dt>Status</dt>
        <dd>{STATUS_LABEL[task.status] ?? task.status}</dd>
        <dt>Priority</dt>
        <dd>{PRIORITY_LABEL[task.priority] ?? task.priority}</dd>
        <dt>Points</dt>
        <dd>{task.points ?? 0}</dd>
        <dt>Made by</dt>
        <dd>{mine ? "You" : `Member ${task.ownerId.slice(0, 8)}`}</dd>
        <dt>Created</dt>
        <dd><time dateTime={task.createdAt}>{fullDate(task.createdAt)}</time></dd>
        <dt>Last changed</dt>
        <dd><time dateTime={task.updatedAt}>{fullDate(task.updatedAt)}</time></dd>
        <dt>Completed</dt>
        <dd>{task.completedAt ? <time dateTime={task.completedAt}>{fullDate(task.completedAt)}</time> : "Not done yet"}</dd>
        {task.agentTicketUrl && (
          <>
            <dt>AI agents</dt>
            <dd>
              {done ? "Was with AI agents" : "With AI agents"} ·{" "}
              <a href={task.agentTicketUrl} target="_blank" rel="noreferrer">ticket</a>
            </dd>
          </>
        )}
        {!task.agentTicketUrl && task.agentSelected && (
          <>
            <dt>AI agents</dt>
            <dd>Ticked for AI agents, not handed over yet</dd>
          </>
        )}
      </dl>

      <h2>Details</h2>
      {task.notes ? <p className="task-notes">{task.notes}</p> : <p className="note">No details written.</p>}

      <h2>Parent task</h2>
      {!task.parentTaskId ? (
        <p className="note">No parent task.</p>
      ) : !parent || parent.error ? (
        <p className="error" role="alert">
          The parent task could not be loaded{parent?.error ? `: ${parent.error.message}` : ""}. Try reloading the page.
        </p>
      ) : !parent.data ? (
        <p className="note">Its parent task has been deleted.</p>
      ) : (
        <p><Link href={`/tasks/${parent.data.id}`}>{parent.data.title}</Link></p>
      )}

      <h2>Sub-tasks</h2>
      {subTasks.error ? (
        <p className="error" role="alert">The sub-tasks could not be loaded: {subTasks.error.message}. Try reloading the page.</p>
      ) : !subTasks.data?.length ? (
        <p className="note">No sub-tasks.</p>
      ) : (
        <ul className="task-links">
          {subTasks.data.map((s) => (
            <li key={s.id}>
              <Link href={`/tasks/${s.id}`}>{s.title}</Link>{" "}
              <span className="note">· {STATUS_LABEL[s.status as TaskStatus] ?? s.status}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="files-box box">
        <h2>Files</h2>
        {files.error ? (
          <p className="error" role="alert">The attached files could not be loaded: {files.error}. They have not been lost; try reloading the page.</p>
        ) : !taskFiles.length ? (
          <p className="note">No files attached.</p>
        ) : (
          <ul className="files">
            {taskFiles.map((f) => (
              <li key={f.id}>
                {!f.url ? (
                  <span className="note">{f.name} (no link could be made; try reloading)</span>
                ) : f.image ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.name}>
                    {/* A signed link to a private file: plain <img>, not next/image, which would fetch it through the web server. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.name} className="thumb" />
                  </a>
                ) : (
                  <a href={f.url}>{f.name}</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {comments === null ? (
        <details className="task-discussion box">
          <summary>Discussion</summary>
          <p className="note">
            Only the member who made a task can read and post in its Discussion for now, so there is nothing to show you here.
          </p>
        </details>
      ) : comments.error ? (
        <details className="task-discussion box">
          <summary>Discussion</summary>
          <p className="error" role="alert">
            Discussion comments could not be loaded: {comments.error}. They have not been lost; try reloading the page.
          </p>
        </details>
      ) : (
        <TaskDiscussion taskId={task.id} taskTitle={task.title} comments={comments.comments} files={commentFiles} userId={user.id} />
      )}
    </Shell>
  );
}

/** The frame every state of the page shares: header, title, and the way back. */
function Shell({ email, title, children }: { email?: string; title?: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader email={email} />
      <main>
        <p><Link href="/">&larr; Back to your tasks</Link></p>
        <h1>{title ?? "Task"}</h1>
        <div className="panel">{children}</div>
      </main>
    </>
  );
}
