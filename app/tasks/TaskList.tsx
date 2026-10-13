"use client";

/**
 * The to-do list: add a task with details, a parent and a priority; edit its
 * title and details, tick it off, reopen, delete, set points and priority, and
 * put a task under another one. Above it, the "Launch AI
 * Agents" switch; on every open task, a box that hands it to AI agents, with
 * a tick-all box in the header row. A task the hand-off lane has filed as a
 * Loop Queue ticket shows "With AI agents" and a link to it. Every change is a server action that goes
 * through core (app/tasks/actions.ts).
 *
 * A save that fails says so next to where it happened and keeps what was
 * typed, including when the network is down and the server never answered
 * (engineering rule 6). Every empty section says why it is empty (rule 7).
 */
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { agentOrder } from "../../core/agents.ts";
import { TASK_PRIORITIES, type TaskPriority } from "../../core/tasks.ts";
import {
  addTask,
  changePoints,
  changePriority,
  chooseForAgents,
  editTask,
  markDone,
  moveUnder,
  removeTask,
  switchAgents,
  type SaveResult,
} from "./actions";

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
  createdAt: string;
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

export default function TaskList({ tasks, agents }: { tasks: ListTask[]; agents: AgentsSwitch }) {
  const [failure, setFailure] = useState<Failure>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(EMPTY_DRAFT);

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

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    // A parent deleted since it was picked shows as "Not a sub-task", so send that.
    const parentTaskId = topLevel.some((p) => p.id === draft.parentTaskId) ? draft.parentTaskId : null;
    const sent = { ...draft, parentTaskId };
    // Cleared only on a confirmed save; a failed one keeps every field as typed.
    if (await run("new", () => addTask(sent))) setDraft(EMPTY_DRAFT);
  }

  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => t.status !== "done");
  const topLevel = tasks.filter((t) => !t.parentTaskId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasChildren = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean));
  const inLine = agentOrder(tasks);
  const placeInLine = new Map(inLine.map((t, i) => [t.id, i + 1]));
  const withAgents = open.filter((t) => t.agentTicketUrl).length;
  // Tick-all covers the tasks still waiting; one already handed over stays with its ticket.
  const tickable = open.filter((t) => !t.agentTicketUrl);
  const allTicked = tickable.length > 0 && tickable.every((t) => t.agentSelected);
  const someTicked = tickable.some((t) => t.agentSelected);

  const row = (t: ListTask, inSection: ListTask[], sub = false) => (
    <TaskRow
      // A fresh row whenever the saved values change, so the boxes show them.
      key={`${t.id}:${t.title}:${t.notes}:${t.points}:${t.parentTaskId}`}
      task={t}
      sub={sub}
      parentTitle={t.parentTaskId && !inSection.some((s) => s.id === t.parentTaskId) ? byId.get(t.parentTaskId)?.title : undefined}
      parents={hasChildren.has(t.id) ? null : topLevel.filter((p) => p.id !== t.id)}
      place={agents.on ? placeInLine.get(t.id) : undefined}
      failure={failure?.at === t.id ? failure.message : null}
      pending={pending}
      run={(action) => run(t.id, action)}
    />
  );

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
        {/* File and image uploads will sit on this line too. */}
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
        </div>
        {failure?.at === "new" && <p className="error" role="alert">{failure.message}</p>}
      </form>

      {tasks.length === 0 ? (
        <p className="note">No tasks yet — add your first one above.</p>
      ) : (
        <>
          <h2>Open</h2>
          {open.length ? (
            <ul className="tasks">
              <li className="task head">
                <label className="cell">
                  <input
                    type="checkbox"
                    aria-label={allTicked ? "Untick every task for AI agents" : "Tick every open task for AI agents"}
                    checked={allTicked}
                    ref={(el) => { if (el) el.indeterminate = someTicked && !allTicked; }}
                    disabled={pending || !tickable.length}
                    onChange={() => run("all", () => chooseForAgents(tickable.map((t) => t.id), !allTicked))}
                  />
                  <small>AI</small>
                </label>
                <span className="cell note"><small>Done</small></span>
                <span className="grow note">Tick the AI box on each task agents should work on; the top box ticks them all.</span>
                {failure?.at === "all" && <p className="error full" role="alert">{failure.message}</p>}
              </li>
              {section(open)}
            </ul>
          ) : (
            <p className="note">Nothing open — every task is done.</p>
          )}
          <h2>Done</h2>
          {done.length ? <ul className="tasks">{section(done)}</ul> : <p className="note">Nothing done yet. Tick a task&rsquo;s box when you finish it.</p>}
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

function TaskRow({
  task,
  sub,
  parentTitle,
  parents,
  place,
  failure,
  pending,
  run,
}: {
  task: ListTask;
  /** Shown indented under its parent. */
  sub: boolean;
  /** Set when the parent sits in the other section, so the link is still visible. */
  parentTitle?: string;
  /** Tasks this one may go under, or null when it has sub-tasks of its own. */
  parents: ListTask[] | null;
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
  const done = task.status === "done";

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

  function savePoints(e?: FormEvent) {
    e?.preventDefault();
    if (points.trim() === String(task.points)) return;
    const value = Number(points);
    void run(async () =>
      points.trim() === "" || !Number.isInteger(value)
        ? { ok: false, error: `Points must be a whole number, like 0, 3 or 10; "${points}" is not one.` }
        : changePoints(task.id, value));
  }

  return (
    <li className={["task", done && "done", sub && "sub"].filter(Boolean).join(" ")}>
      <span className="cell">
        {!done && !task.agentTicketUrl && (
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
      <span className="cell">
        <input
          type="checkbox"
          aria-label={done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
          checked={done}
          disabled={pending}
          onChange={() => run(() => markDone(task.id, !done))}
        />
      </span>
      {editing ? (
        <form onSubmit={saveEdit} className="grow edit">
          <input aria-label="Task title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
          <textarea
            aria-label={`Details of "${task.title}"`}
            placeholder="Details (optional)"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <span>
            <button type="submit" disabled={pending || !title.trim()}>Save</button>
          </span>
        </form>
      ) : (
        <span className="grow">
          {task.title} <span className="note">· {task.points} pts</span>
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
      <span className="controls">
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
        <form onSubmit={savePoints}>
          <input
            aria-label={`Points for "${task.title}"`}
            className="points"
            type="number"
            step="1"
            inputMode="numeric"
            value={points}
            onChange={(e) => setPointsText(e.target.value)}
            onBlur={() => savePoints()}
          />
        </form>
        {parents && (
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
        )}
        {editing ? (
          <button type="button" className="link" onClick={cancelEdit}>cancel</button>
        ) : (
          <button type="button" className="link" onClick={() => setEditing(true)}>edit</button>
        )}
        <button type="button" className="link" disabled={pending} onClick={() => run(() => removeTask(task.id))}>delete</button>
      </span>
      {failure && <p className="error full" role="alert">{failure}</p>}
    </li>
  );
}
