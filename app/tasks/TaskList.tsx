"use client";

/**
 * The to-do list: add, rename, tick off, reopen, delete, set points, and put
 * a task under another one. Every change is a server action that goes
 * through core (app/tasks/actions.ts).
 *
 * A save that fails says so next to where it happened and keeps what was
 * typed, including when the network is down and the server never answered
 * (engineering rule 6). Every empty section says why it is empty (rule 7).
 */
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { addTask, changePoints, markDone, moveUnder, removeTask, renameTask, type SaveResult } from "./actions";

export interface ListTask {
  id: string;
  title: string;
  status: string;
  points: number;
  parentTaskId: string | null;
}

/** Where a failed save happened: "new" for the add box, or a task id. */
type Failure = { at: string; message: string } | null;

const UNREACHABLE =
  "Could not reach WaveCenter, so this was not saved. Check your connection and try again; what you typed is still here.";

export default function TaskList({ tasks }: { tasks: ListTask[] }) {
  const [failure, setFailure] = useState<Failure>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

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
    if (!draft.trim()) return;
    if (await run("new", () => addTask(draft))) setDraft("");
  }

  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => t.status !== "done");
  const topLevel = tasks.filter((t) => !t.parentTaskId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasChildren = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean));

  const row = (t: ListTask, inSection: ListTask[], sub = false) => (
    <TaskRow
      // A fresh row whenever the saved values change, so the boxes show them.
      key={`${t.id}:${t.title}:${t.points}:${t.parentTaskId}`}
      task={t}
      sub={sub}
      parentTitle={t.parentTaskId && !inSection.some((s) => s.id === t.parentTaskId) ? byId.get(t.parentTaskId)?.title : undefined}
      parents={hasChildren.has(t.id) ? null : topLevel.filter((p) => p.id !== t.id)}
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
      <form onSubmit={add} className="add">
        <input
          aria-label="New task"
          placeholder="Add a task and press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={pending || !draft.trim()}>Add</button>
      </form>
      {failure?.at === "new" && <p className="error" role="alert">{failure.message}</p>}

      {tasks.length === 0 ? (
        <p className="note">No tasks yet — add your first one above.</p>
      ) : (
        <>
          <h2>Open</h2>
          {open.length ? <ul className="tasks">{section(open)}</ul> : <p className="note">Nothing open — every task is done.</p>}
          <h2>Done</h2>
          {done.length ? <ul className="tasks">{section(done)}</ul> : <p className="note">Nothing done yet. Tick a task&rsquo;s box when you finish it.</p>}
        </>
      )}
    </>
  );
}

function TaskRow({
  task,
  sub,
  parentTitle,
  parents,
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
  failure: string | null;
  pending: boolean;
  run: (action: () => Promise<SaveResult>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [points, setPointsText] = useState(String(task.points));
  const done = task.status === "done";

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (title.trim() === task.title) return setEditing(false);
    if (await run(() => renameTask(task.id, title))) setEditing(false);
  }

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
      <input
        type="checkbox"
        aria-label={done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        checked={done}
        disabled={pending}
        onChange={() => run(() => markDone(task.id, !done))}
      />
      {editing ? (
        <form onSubmit={rename} className="grow">
          <input aria-label="Task title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </form>
      ) : (
        <span className="grow">
          {task.title} <span className="note">· {task.points} pts</span>
          {parentTitle && <span className="note"> · sub-task of &ldquo;{parentTitle}&rdquo;</span>}
        </span>
      )}
      <span className="controls">
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
          <button type="button" className="link" onClick={() => { setTitle(task.title); setEditing(false); }}>cancel</button>
        ) : (
          <button type="button" className="link" onClick={() => setEditing(true)}>edit</button>
        )}
        <button type="button" className="link" disabled={pending} onClick={() => run(() => removeTask(task.id))}>delete</button>
      </span>
      {failure && <p className="error full" role="alert">{failure}</p>}
    </li>
  );
}
