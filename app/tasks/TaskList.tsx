"use client";

/**
 * The to-do list: add a task with details, a parent, a priority and files;
 * edit its title and details, tick it off, reopen, delete, set points and
 * priority, put a task under another one, and attach files to it (pictures
 * show as small thumbnails). Above it, the "Launch AI
 * Agents" switch; on every open task, a box that hands it to AI agents, with
 * a tick-all box in the header row. A task the hand-off lane has filed as a
 * Loop Queue ticket shows "With AI agents" and a link to it. Every change is a server action that goes
 * through core (app/tasks/actions.ts).
 *
 * A save that fails says so next to where it happened and keeps what was
 * typed, including when the network is down and the server never answered
 * (engineering rule 6). Every empty section says why it is empty (rule 7).
 *
 * The list shows in columns under a header row. Clicking Title, Priority,
 * Points or Created sorts by it; the filter bar above narrows by text,
 * priority, status, points and creator. Both work on the tasks already loaded
 * (listView.ts), and sub-tasks stay under their parent either way.
 *
 * Every member's tasks are listed, each saying whose it is (Dane,
 * 2026-10-27). A member changes only their own; on anyone's task they can
 * vote on its points and priority, and see the average and how many have
 * voted (core/votes.ts). Once a task has votes, the average is its points
 * and priority, so its owner's boxes give way to the average.
 */
import { useRef, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { agentOrder } from "../../core/agents.ts";
import { checkFile } from "../../core/files.ts";
import { TASK_PRIORITIES, type TaskPriority } from "../../core/tasks.ts";
import { summarizeVotes } from "../../core/votes.ts";
import {
  addTask,
  changePoints,
  changePriority,
  chooseForAgents,
  editTask,
  finishUpload,
  markDone,
  moveUnder,
  removeAttachment,
  removeTask,
  startUpload,
  switchAgents,
  vote,
  type SaveResult,
} from "./actions";
import {
  filterTasks,
  fullDate,
  isFiltering,
  nextSort,
  NO_FILTER,
  sectionTasks,
  shortDate,
  sortTasks,
  STATUS_FILTERS,
  STATUS_FILTER_LABEL,
  type Filter,
  type Sort,
  type SortKey,
} from "./listView.ts";

export interface ListTask {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  points: number;
  parentTaskId: string | null;
  priority: TaskPriority;
  agentSelected: boolean;
  /** The Loop Queue ticket the task was handed to, if any. */
  agentTicketUrl: string | null;
  /** The member who created it. */
  ownerId: string;
  createdAt: string;
}

/** A file attached to a task, with a short-lived link to it (null if none could be made). */
export interface ListFile {
  id: string;
  taskId: string;
  name: string;
  image: boolean;
  url: string | null;
}

/** One member's vote on a task; either part may be missing. */
export interface ListVote {
  taskId: string;
  memberId: string;
  points: number | null;
  priority: TaskPriority | null;
}

/** The member's "Launch AI Agents" switch; `on` is null if it could not be read. */
export interface AgentsSwitch {
  on: boolean | null;
  error: string | null;
}

const PRIORITY_LABEL: Record<TaskPriority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

/** Where a failed save happened: "new" for the add box, "agents" for the switch, "all" for tick-all, or a task id. */
type Failure = { at: string; message: string } | null;

/** The add form when empty: no details, no parent, Normal priority. */
const EMPTY_DRAFT = { title: "", notes: "", parentTaskId: "", priority: "normal" as TaskPriority };

const UNREACHABLE =
  "Could not reach WaveCenter, so this was not saved. Check your connection and try again; what you typed is still here.";

/**
 * Attach files to a task, one after another (app/tasks/actions.ts explains
 * the three steps). A file over 10 MB is refused here, before anything is
 * sent. Resolves ok only if every file was attached; otherwise the answer
 * names what failed, and a failed file leaves nothing behind.
 */
async function uploadFiles(taskId: string, files: File[]): Promise<SaveResult> {
  const problems: string[] = [];
  for (const file of files) {
    const result = await uploadFile(taskId, file).catch((): SaveResult => ({ ok: false, error: UNREACHABLE }));
    if (!result.ok) problems.push(result.error);
  }
  if (!problems.length) return { ok: true };
  const attached = files.length - problems.length;
  return { ok: false, error: `${attached ? `${attached} of ${files.length} files were attached. ` : ""}${problems.join(" ")}` };
}

async function uploadFile(taskId: string, file: File): Promise<SaveResult> {
  try {
    checkFile(file.name, file.size);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const ticket = await startUpload(taskId, file.name, file.size);
  if (!ticket.ok) return ticket;
  const notSent = `"${file.name}" could not be sent to file storage, so it was not attached. Check your connection and try again.`;
  try {
    const sent = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!sent.ok) return { ok: false, error: `File storage refused "${file.name}" (error ${sent.status}), so it was not attached. Try again.` };
  } catch {
    return { ok: false, error: notSent };
  }
  return finishUpload({ taskId, path: ticket.path, name: file.name, contentType: file.type, sizeBytes: file.size });
}

/** The files picked in a file box, then the box emptied so the same file can be picked again. */
function picked(e: ChangeEvent<HTMLInputElement>): File[] {
  const files = [...(e.target.files ?? [])];
  e.target.value = "";
  return files;
}

export default function TaskList({
  tasks,
  agents,
  files,
  votes,
  userId,
}: {
  tasks: ListTask[];
  agents: AgentsSwitch;
  /** Every member's votes, or why they could not be loaded. */
  votes: { votes: ListVote[]; error: string | null };
  /** The signed-in member, so the creator filter can say "You". */
  userId: string;
  /** Every attached file, or why they could not be loaded. */
  files: { files: ListFile[]; error: string | null };
}) {
  const [failure, setFailure] = useState<Failure>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [sort, setSort] = useState<Sort>(null);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);

  /** Run one save; report how it went. Resolves true only on a confirmed save. */
  function run(at: string, action: () => Promise<SaveResult>): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: SaveResult;
        try {
          result = await action();
        } catch {
          result = { ok: false, error: UNREACHABLE };
        }
        setFailure(result.ok ? null : { at, message: result.error });
        resolve(result.ok);
      });
    });
  }

  /** Add the task, then attach any files picked for it. */
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    // A parent deleted since it was picked shows as "Not a sub-task", so send that.
    const parentTaskId = topLevel.some((p) => p.id === draft.parentTaskId) ? draft.parentTaskId : null;
    const sent = { ...draft, parentTaskId };
    // Cleared only on a confirmed save; a failed one keeps every field as typed.
    const added = await run("new", async () => {
      const result = await addTask(sent);
      if (!result.ok || !result.id || !draftFiles.length) return result;
      // The task exists now, so clear the form even if a file fails: adding again would make it twice.
      setDraft(EMPTY_DRAFT);
      const attached = await uploadFiles(result.id, draftFiles);
      setDraftFiles([]);
      return attached.ok ? attached : { ok: false, error: `The task was added, but not every file: ${attached.error}` };
    });
    if (added) {
      setDraft(EMPTY_DRAFT);
      setDraftFiles([]);
    }
  }

  /** Pick files for the task being added. A file over 10 MB is refused straight away. */
  function pickForNew(e: ChangeEvent<HTMLInputElement>) {
    const chosen = picked(e);
    const refused: string[] = [];
    const ok = chosen.filter((f) => {
      try {
        checkFile(f.name, f.size);
        return true;
      } catch (err) {
        refused.push((err as Error).message);
        return false;
      }
    });
    setDraftFiles((now) => [...now, ...ok]);
    setFailure(refused.length ? { at: "new", message: refused.join(" ") } : null);
  }

  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => t.status !== "done");
  // The AI agents, the tick boxes and the parent lists are about the member's own tasks.
  const own = tasks.filter((t) => t.ownerId === userId);
  const ownOpen = own.filter((t) => t.status !== "done");
  const topLevel = own.filter((t) => !t.parentTaskId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasChildren = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean));
  const inLine = agentOrder(own);
  const placeInLine = new Map(inLine.map((t, i) => [t.id, i + 1]));
  const filesByTask = new Map<string, ListFile[]>();
  for (const f of files.files) filesByTask.set(f.taskId, [...(filesByTask.get(f.taskId) ?? []), f]);
  const votesByTask = new Map<string, ListVote[]>();
  for (const v of votes.votes) votesByTask.set(v.taskId, [...(votesByTask.get(v.taskId) ?? []), v]);
  const withAgents = ownOpen.filter((t) => t.agentTicketUrl).length;
  // Tick-all covers the tasks still waiting; one already handed over stays with its ticket.
  const tickable = ownOpen.filter((t) => !t.agentTicketUrl);
  const allTicked = tickable.length > 0 && tickable.every((t) => t.agentSelected);
  const someTicked = tickable.some((t) => t.agentSelected);
  const filtering = isFiltering(filter);
  const { shown, contextOnly } = filterTasks(sortTasks(tasks, sort), filter);
  const shownOpen = sectionTasks(shown, contextOnly, (t) => t.status !== "done");
  const shownDone = sectionTasks(shown, contextOnly, (t) => t.status === "done");
  const creators = [...new Set(tasks.map((t) => t.ownerId))].sort((a, b) => (a === userId ? -1 : b === userId ? 1 : 0));

  const row = (t: ListTask, inSection: ListTask[], sub = false) => {
    const taskVotes = votesByTask.get(t.id) ?? [];
    const myVote = taskVotes.find((v) => v.memberId === userId) ?? null;
    return (
    <TaskRow
      // A fresh row whenever the saved values change, so the boxes show them.
      key={`${t.id}:${t.title}:${t.notes}:${t.points}:${t.priority}:${t.parentTaskId}:${myVote?.points}:${myVote?.priority}`}
      task={t}
      owner={t.ownerId === userId ? "you" : `member ${t.ownerId.slice(0, 8)}`}
      mine={t.ownerId === userId}
      votes={taskVotes}
      myVote={myVote}
      votesError={votes.error}
      sub={sub}
      context={contextOnly.has(t.id)}
      parentTitle={t.parentTaskId && !inSection.some((s) => s.id === t.parentTaskId) ? byId.get(t.parentTaskId)?.title : undefined}
      parents={hasChildren.has(t.id) ? null : topLevel.filter((p) => p.id !== t.id)}
      files={filesByTask.get(t.id) ?? []}
      place={agents.on ? placeInLine.get(t.id) : undefined}
      failure={failure?.at === t.id ? failure.message : null}
      pending={pending}
      run={(action) => run(t.id, action)}
    />
    );
  };

  /**
   * A section's top-level tasks, each followed by its sub-tasks in that
   * section, indented. This list only makes one level, but a deeper tree
   * (from another tool) still shows every task rather than dropping some.
   */
  const section = (list: ListTask[]) => {
    const ids = new Set(list.map((t) => t.id));
    const shown = new Set<string>();
    const walk = (t: ListTask, sub: boolean): ReactNode[] => {
      if (shown.has(t.id)) return [];
      shown.add(t.id);
      return [row(t, list, sub), ...list.filter((c) => c.parentTaskId === t.id).flatMap((c) => walk(c, true))];
    };
    const tree = list.filter((t) => !t.parentTaskId || !ids.has(t.parentTaskId)).flatMap((t) => walk(t, false));
    // Anything still unshown sits in a loop of parents; show it rather than hide it.
    return [...tree, ...list.filter((t) => !shown.has(t.id)).flatMap((t) => walk(t, false))];
  };

  /** A header that sorts the list: shows the sort and its direction, and says so to screen readers. */
  const sortHeader = (key: SortKey, label: string) => {
    const on = sort?.key === key;
    return (
      <span
        className={`col-${key}`}
        role="columnheader"
        aria-sort={on ? (sort.ascending ? "ascending" : "descending") : "none"}
      >
        <button type="button" className="sort" onClick={() => setSort(nextSort(sort, key))}>
          {label}
          <span aria-hidden="true" className="arrow">{on ? (sort.ascending ? "▲" : "▼") : ""}</span>
        </button>
      </span>
    );
  };

  /** The header row of a section: column names, the sortable ones as buttons. */
  const head = (tickAll: ReactNode) => (
    <li className="task head" role="row">
      <span className="cell" role="columnheader">{tickAll ?? <small>AI</small>}</span>
      <span className="cell note" role="columnheader"><small>Done</small></span>
      {sortHeader("title", "Title")}
      {sortHeader("priority", "Priority")}
      {sortHeader("points", "Points")}
      {sortHeader("created", "Created")}
      <span className="col-parent note" role="columnheader">Parent</span>
      <span className="col-actions note" role="columnheader">Actions</span>
      {failure?.at === "all" && tickAll && (
        <div className="full" role="cell">
          <p className="error" role="alert">{failure.message}</p>
        </div>
      )}
    </li>
  );

  /** Said when the filters leave a section empty, with a way out (rule 7). */
  const noMatch = (which: string) => (
    <p className="note">
      No {which} tasks match this filter.{" "}
      <button type="button" className="link" onClick={() => setFilter(NO_FILTER)}>Clear the filter</button>
    </p>
  );

  return (
    <>
      <section className="agents" aria-label="AI agents">
        {agents.on === null ? (
          <p className="error" role="alert">
            Could not read whether AI agents are on: {agents.error}. Agents are treated as off; try reloading the page.
          </p>
        ) : (
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={agents.on}
              disabled={pending}
              onChange={() => run("agents", () => switchAgents(!agents.on))}
            />
            <span>Launch AI Agents</span>
          </label>
        )}
        {agents.on !== null && <p className="note">{agentsLine(agents.on, inLine.length, withAgents)}</p>}
        <p className="note">
          Turning this off stops new hand-offs; tasks already with the AI agents carry on until they are finished.
        </p>
        {failure?.at === "agents" && <p className="error" role="alert">{failure.message}</p>}
      </section>

      <form onSubmit={add} className="add" aria-label="Add a task">
        <div className="line">
          <input
            aria-label="New task"
            placeholder="Add a task and press Enter"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <button type="submit" disabled={pending || !draft.title.trim()}>Add</button>
        </div>
        <textarea
          aria-label="Details of the new task"
          placeholder="Details (optional)"
          rows={2}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
        <div className="line">
          <select
            aria-label="Parent of the new task"
            value={draft.parentTaskId}
            onChange={(e) => setDraft({ ...draft, parentTaskId: e.target.value })}
          >
            <option value="">Not a sub-task</option>
            {topLevel.map((p) => (
              <option key={p.id} value={p.id}>Sub-task of: {p.title}</option>
            ))}
          </select>
          <select
            aria-label="Priority of the new task"
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]} priority</option>
            ))}
          </select>
          <label className="link attach">
            attach
            <input type="file" multiple hidden aria-label="Attach files to the new task" disabled={pending} onChange={pickForNew} />
          </label>
        </div>
        {draftFiles.length > 0 && (
          <p className="note">
            To attach when you add:{" "}
            {draftFiles.map((f, i) => (
              <span key={i} className="chip">
                {f.name}{" "}
                <button type="button" className="link" aria-label={`Do not attach "${f.name}"`} onClick={() => setDraftFiles((now) => now.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </p>
        )}
        {failure?.at === "new" && <p className="error" role="alert">{failure.message}</p>}
      </form>
      {files.error && (
        <p className="error" role="alert">
          Attached files could not be loaded: {files.error}. They have not been lost; try reloading the page.
        </p>
      )}
      {votes.error && (
        <p className="error" role="alert">
          Votes could not be loaded: {votes.error}. No vote has been lost, but voting is off until you reload the page.
        </p>
      )}

      {tasks.length === 0 ? (
        <p className="note">No tasks yet — add your first one above.</p>
      ) : (
        <>
          <form className="filters" aria-label="Filter tasks" onSubmit={(e) => e.preventDefault()}>
            <input
              type="search"
              aria-label="Filter by words in the title or details"
              placeholder="Filter by title or details"
              value={filter.text}
              onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            />
            <select
              aria-label="Filter by priority"
              value={filter.priority}
              onChange={(e) => setFilter({ ...filter, priority: e.target.value as Filter["priority"] })}
            >
              <option value="all">Any priority</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value as Filter["status"] })}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{STATUS_FILTER_LABEL[s]}</option>
              ))}
            </select>
            <span className="range">
              <span className="note">Points</span>
              <input
                type="number"
                step="1"
                inputMode="numeric"
                aria-label="Fewest points"
                placeholder="from"
                value={filter.minPoints}
                onChange={(e) => setFilter({ ...filter, minPoints: e.target.value })}
              />
              <input
                type="number"
                step="1"
                inputMode="numeric"
                aria-label="Most points"
                placeholder="to"
                value={filter.maxPoints}
                onChange={(e) => setFilter({ ...filter, maxPoints: e.target.value })}
              />
            </span>
            <select
              aria-label="Filter by who created the task"
              value={filter.creator}
              onChange={(e) => setFilter({ ...filter, creator: e.target.value })}
            >
              <option value="all">Created by anyone</option>
              {creators.map((id) => (
                <option key={id} value={id}>Created by {id === userId ? "you" : `member ${id.slice(0, 8)}`}</option>
              ))}
            </select>
            {filtering && (
              <button type="button" className="link" onClick={() => setFilter(NO_FILTER)}>Clear filters</button>
            )}
          </form>
          {filtering && (
            <p className="note" role="status">
              Showing {shown.length - contextOnly.size} of {tasks.length} tasks
              {[...shownOpen, ...shownDone].some((t) => contextOnly.has(t.id)) && "; a dimmed task is shown only because a sub-task of it matches"}.
            </p>
          )}

          <h2>Open</h2>
          {!open.length ? (
            <p className="note">Nothing open — every task is done.</p>
          ) : (
            <>
              <p className="note hint">Tick the AI box on each of your tasks agents should work on; the top box ticks every open task of yours.</p>
              {shownOpen.length ? (
                <ul className="tasks" role="table" aria-label="Open tasks">
                  {head(
                    <input
                      type="checkbox"
                      aria-label={allTicked ? "Untick every task for AI agents" : "Tick every open task for AI agents"}
                      checked={allTicked}
                      ref={(el) => { if (el) el.indeterminate = someTicked && !allTicked; }}
                      disabled={pending || !tickable.length}
                      onChange={() => run("all", () => chooseForAgents(tickable.map((t) => t.id), !allTicked))}
                    />,
                  )}
                  {section(shownOpen)}
                </ul>
              ) : (
                noMatch("open")
              )}
              {!shownOpen.length && failure?.at === "all" && <p className="error" role="alert">{failure.message}</p>}
            </>
          )}
          <h2>Done</h2>
          {!done.length ? (
            <p className="note">Nothing done yet. Tick a task&rsquo;s box when you finish it.</p>
          ) : shownDone.length ? (
            <ul className="tasks" role="table" aria-label="Done tasks">
              {head(null)}
              {section(shownDone)}
            </ul>
          ) : (
            noMatch("done")
          )}
        </>
      )}
    </>
  );
}

/** The line under the switch: what the agents will do, in plain words. */
function agentsLine(on: boolean, ticked: number, handed: number): string {
  const count = `${ticked} ticked task${ticked === 1 ? "" : "s"}`;
  const busy = handed ? ` ${handed} task${handed === 1 ? " is" : "s are"} with them now.` : "";
  if (on && ticked) {
    return `Agents are on. ${count[0].toUpperCase()}${count.slice(1)} waiting: they are handed over one at a time, highest priority first, then oldest first.${busy}`;
  }
  if (on) return `Agents are on, but no tasks are waiting for them. Tick a task's AI box to hand it over.${busy}`;
  if (ticked) return `Agents are off. ${count[0].toUpperCase()}${count.slice(1)} will wait until you turn them on.${busy}`;
  return `Agents are off. Tick the tasks you want AI agents to work on, then turn this on.${busy}`;
}

/** Small line icons drawn in the page's own colour; the button around each one carries its name. */
const ICON_PATHS = {
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  attach: "M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7",
  delete: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
};

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function TaskRow({
  task,
  owner,
  mine,
  votes,
  myVote,
  votesError,
  sub,
  context,
  parentTitle,
  parents,
  files,
  place,
  failure,
  pending,
  run,
}: {
  task: ListTask;
  /** Whose task it is, in words: "you" or "member 1a2b3c4d". */
  owner: string;
  /** The signed-in member's own task, so they may change it. */
  mine: boolean;
  /** Every member's votes on it. */
  votes: ListVote[];
  /** The signed-in member's own vote on it, if any. */
  myVote: ListVote | null;
  /** Set when votes could not be loaded: then nobody can vote until a reload. */
  votesError: string | null;
  /** Shown indented under its parent. */
  sub: boolean;
  /** Shown only because a sub-task of it matches the filter, so dimmed. */
  context: boolean;
  /** Set when the parent sits in the other section, so the link is still visible. */
  parentTitle?: string;
  /** Tasks this one may go under, or null when it has sub-tasks of its own. */
  parents: ListTask[] | null;
  /** The files attached to it. */
  files: ListFile[];
  /** Its place in the agents' line, shown while agents are on. */
  place?: number;
  failure: string | null;
  pending: boolean;
  run: (action: () => Promise<SaveResult>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [expanded, setExpanded] = useState(false);
  const [points, setPointsText] = useState(String(task.points));
  const [votePoints, setVotePoints] = useState(myVote?.points == null ? "" : String(myVote.points));
  const attachBox = useRef<HTMLInputElement>(null);
  const done = task.status === "done";
  const summary = summarizeVotes(votes);
  // Once members vote on a part, the average decides it and the owner's box gives way (core/votes.ts).
  const pointsByVote = summary.pointsVotes > 0;
  const priorityByVote = summary.priorityVotes > 0;

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (title.trim() === task.title && notes.trim() === (task.notes ?? "")) return setEditing(false);
    if (await run(() => editTask(task.id, title, notes))) setEditing(false);
  }

  function cancelEdit() {
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setEditing(false);
  }

  const [firstLine, ...moreLines] = (task.notes ?? "").split("\n");

  async function savePoints(e?: FormEvent) {
    e?.preventDefault();
    if (points.trim() === String(task.points)) return;
    const value = Number(points);
    const saved = await run(async () =>
      points.trim() === "" || !Number.isInteger(value)
        ? { ok: false, error: `Points must be a whole number, like 0, 3 or 10; "${points}" is not one.` }
        : changePoints(task.id, value));
    // A refused number goes back to what is stored; the message says why.
    if (!saved) setPointsText(String(task.points));
  }

  /** Save the member's points vote; an emptied box withdraws it. */
  async function saveVotePoints(e?: FormEvent) {
    e?.preventDefault();
    const was = myVote?.points == null ? "" : String(myVote.points);
    if (votePoints.trim() === was) return;
    const value = Number(votePoints);
    const saved = await run(async () =>
      votePoints.trim() === ""
        ? vote(task.id, { points: null })
        : !Number.isInteger(value)
          ? { ok: false, error: `A points vote must be a whole number, like 0, 3 or 10; "${votePoints}" is not one.` }
          : vote(task.id, { points: value }));
    if (!saved) setVotePoints(was);
  }

  return (
    <li className={["task", done && "done", sub && "sub", context && "context"].filter(Boolean).join(" ")} role="row">
      <span className="cell" role="cell">
        {mine && !done && !task.agentTicketUrl && (
          <input
            type="checkbox"
            className="ai"
            aria-label={task.agentSelected ? `Take "${task.title}" back from AI agents` : `Hand "${task.title}" to AI agents`}
            checked={task.agentSelected}
            disabled={pending}
            onChange={() => run(() => chooseForAgents([task.id], !task.agentSelected))}
          />
        )}
      </span>
      <span className="cell" role="cell">
        <input
          type="checkbox"
          aria-label={done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
          checked={done}
          disabled={pending || !mine}
          title={mine ? undefined : `Only ${owner} can tick this off`}
          onChange={() => run(() => markDone(task.id, !done))}
        />
      </span>
      {editing ? (
        <form onSubmit={saveEdit} className="col-title edit" role="cell">
          <input aria-label="Task title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
          <textarea
            aria-label={`Details of "${task.title}"`}
            placeholder="Details (optional)"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <span>
            <button type="submit" disabled={pending || !title.trim()}>Save</button>{" "}
            <button type="button" className="link" onClick={cancelEdit}>cancel</button>
          </span>
        </form>
      ) : (
        <span className="col-title" role="cell">
          <span className="title">{task.title}</span>
          {place && <span className="badge"> AI #{place}</span>}
          {task.agentTicketUrl && (
            <span className="badge">
              {" "}
              {done ? "Was with AI agents" : "With AI agents"} ·{" "}
              <a href={task.agentTicketUrl} target="_blank" rel="noreferrer">ticket</a>
              {done && " · reopening it forgets this ticket, so ticking it again files a new one"}
            </span>
          )}
          {parentTitle && <span className="note"> · sub-task of &ldquo;{parentTitle}&rdquo;</span>}
          {task.notes && (
            <span className="details">
              {expanded ? task.notes : firstLine}
              {moreLines.length > 0 && (
                <>
                  {" "}
                  <button type="button" className="link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                    {expanded ? "less" : "more"}
                  </button>
                </>
              )}
            </span>
          )}
        </span>
      )}
      <span className="col-priority" role="cell">
        {mine && !priorityByVote ? (
          <select
            aria-label={`Priority of "${task.title}"`}
            value={task.priority}
            disabled={pending}
            onChange={(e) => run(() => changePriority(task.id, e.target.value as TaskPriority))}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        ) : (
          <span title={priorityByVote ? "The average of members' votes" : undefined}>{PRIORITY_LABEL[task.priority]}</span>
        )}
      </span>
      {/* A done task's points are locked (core/points.ts), voted points are the average, and only the
          owner may set their own: otherwise the column shows the number, with no box to change it. */}
      {done || !mine || pointsByVote ? (
        <span className="col-points" role="cell" title={pointsByVote && !done ? "The average of members' votes" : undefined}>
          <span className="points">{task.points}</span>
          <span className="unit note">pts</span>
        </span>
      ) : (
        <form className="col-points" role="cell" onSubmit={savePoints}>
          <input
            aria-label={`Points for "${task.title}"`}
            className="points"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={points}
            onChange={(e) => setPointsText(e.target.value)}
            onBlur={() => savePoints()}
          />
          <span className="unit note">pts</span>
        </form>
      )}
      <span className="col-created note" role="cell">
        <time dateTime={task.createdAt} title={fullDate(task.createdAt)}>{shortDate(task.createdAt)}</time>
        <span className="owner">by {owner}</span>
      </span>
      <span className="col-parent" role="cell">
        {!mine ? (
          <span className="note">{task.parentTaskId ? "Sub-task" : "—"}</span>
        ) : parents ? (
          <select
            aria-label={`Make "${task.title}" a sub-task of`}
            value={task.parentTaskId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => moveUnder(task.id, e.target.value || null))}
          >
            <option value="">Not a sub-task</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>Sub-task of: {p.title}</option>
            ))}
          </select>
        ) : (
          <span className="note">Has sub-tasks</span>
        )}
      </span>
      <span className="col-actions" role="cell">
        {mine && (<>
        <button
          type="button"
          className="icon-button"
          aria-label={editing ? `Editing "${task.title}"` : `Edit "${task.title}"`}
          title="Edit"
          disabled={editing}
          onClick={() => setEditing(true)}
        >
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Attach files to "${task.title}"`}
          title="Attach files"
          disabled={pending}
          onClick={() => attachBox.current?.click()}
        >
          <Icon name="attach" />
        </button>
        <input
          ref={attachBox}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          disabled={pending}
          onChange={(e) => {
            const chosen = picked(e);
            if (chosen.length) void run(() => uploadFiles(task.id, chosen));
          }}
        />
        <button
          type="button"
          className="icon-button danger"
          aria-label={`Delete "${task.title}"`}
          title="Delete"
          disabled={pending}
          onClick={() => run(() => removeTask(task.id))}
        >
          <Icon name="delete" />
        </button>
        </>)}
      </span>
      {files.length > 0 && (
        <div className="full" role="cell">
          <ul className="files">
            {files.map((f) => (
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
                {mine && (
                  <button type="button" className="link" aria-label={`Remove "${f.name}"`} disabled={pending} onClick={() => run(() => removeAttachment(f.id))}>
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="full votes" role="cell">
        <span className="tally">
          {votesError
            ? "Votes could not be loaded"
            : summary.voters === 0
            ? "No votes yet"
            : [
                summary.points === null ? "No points votes" : `Average ${summary.points} pts`,
                summary.priority === null ? "no priority votes" : PRIORITY_LABEL[summary.priority],
                `${summary.voters} vote${summary.voters === 1 ? "" : "s"}`,
              ].join(" · ")}
          {done && summary.pointsVotes > 0 && summary.points !== task.points && " (done, so its points stay locked at the value it finished with)"}
        </span>
        {votesError ? (
          <span className="note">Voting is off until the page is reloaded.</span>
        ) : (
          <form className="my-vote" aria-label={`Your vote on "${task.title}"`} onSubmit={saveVotePoints}>
            <span className="note">Your vote:</span>
            <input
              aria-label={`Your points vote on "${task.title}"`}
              className="points"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="pts"
              value={votePoints}
              disabled={pending}
              onChange={(e) => setVotePoints(e.target.value)}
              onBlur={() => saveVotePoints()}
            />
            <select
              aria-label={`Your priority vote on "${task.title}"`}
              value={myVote?.priority ?? ""}
              disabled={pending}
              onChange={(e) => run(() => vote(task.id, { priority: (e.target.value || null) as TaskPriority | null }))}
            >
              <option value="">No priority vote</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
            {myVote && (
              <button
                type="button"
                className="link"
                disabled={pending}
                onClick={() => run(() => vote(task.id, { points: null, priority: null }))}
              >
                withdraw my vote
              </button>
            )}
          </form>
        )}
      </div>
      {failure && (
        <div className="full" role="cell">
          <p className="error" role="alert">{failure}</p>
        </div>
      )}
    </li>
  );
}
