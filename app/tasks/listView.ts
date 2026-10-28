/**
 * How the task list is filtered and sorted in the browser, on the tasks the
 * page already loaded: nothing here reads or writes the database. Plain
 * functions with their own tests (listView.test.ts), kept apart from the
 * screen so the rules can be checked without one.
 */
import { TASK_PRIORITIES, type TaskPriority } from "../../core/tasks.ts";

/** The fields of a task the filters and sorts look at. */
export interface ViewTask {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  points: number;
  parentTaskId: string | null;
  priority: TaskPriority;
  agentSelected: boolean;
  agentTicketUrl: string | null;
  ownerId: string;
  createdAt: string;
}

export type SortKey = "title" | "priority" | "points" | "created";
/** No sort means the saved order: position, then date added, as the page reads it. */
export type Sort = { key: SortKey; ascending: boolean } | null;

/** The way each column sorts on its first click: A–Z, Urgent first, most points first, newest first. */
export const FIRST_CLICK_ASCENDING: Record<SortKey, boolean> = { title: true, priority: true, points: false, created: false };

/** One click on a column header: sort by it, or reverse it if it is already the sort. */
export function nextSort(now: Sort, key: SortKey): Sort {
  if (now?.key === key) return { key, ascending: !now.ascending };
  return { key, ascending: FIRST_CLICK_ASCENDING[key] };
}

const PRIORITY_RANK = new Map(TASK_PRIORITIES.map((p, i) => [p, i]));

function compare(a: ViewTask, b: ViewTask, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
    case "priority":
      return (PRIORITY_RANK.get(a.priority) ?? 0) - (PRIORITY_RANK.get(b.priority) ?? 0);
    case "points":
      return a.points - b.points;
    case "created":
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }
}

/**
 * The tasks in the chosen order. Ties keep the saved order, so a sort never
 * shuffles tasks that are equal on its column. Sub-tasks are grouped under
 * their parent later, when the list is drawn, so sorting the whole list
 * orders the top-level tasks and each parent's sub-tasks among themselves.
 */
export function sortTasks<T extends ViewTask>(tasks: T[], sort: Sort): T[] {
  if (!sort) return tasks;
  const sign = sort.ascending ? 1 : -1;
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => sign * compare(a.t, b.t, sort.key) || a.i - b.i)
    .map(({ t }) => t);
}

export const STATUS_FILTERS = ["all", "open", "done", "ticked", "with-agents"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "Any status",
  open: "Open",
  done: "Done",
  ticked: "Ticked for AI agents",
  "with-agents": "With AI agents",
};

export interface Filter {
  /** Matched against title and details, ignoring capitals. */
  text: string;
  priority: TaskPriority | "all";
  status: StatusFilter;
  /** Points range, each end typed as text; blank means no limit. */
  minPoints: string;
  maxPoints: string;
  /** The member who created the task, or "all". */
  creator: string;
}

export const NO_FILTER: Filter = { text: "", priority: "all", status: "all", minPoints: "", maxPoints: "", creator: "all" };

export function isFiltering(f: Filter): boolean {
  return (
    f.text.trim() !== "" ||
    f.priority !== "all" ||
    f.status !== "all" ||
    f.minPoints.trim() !== "" ||
    f.maxPoints.trim() !== "" ||
    f.creator !== "all"
  );
}

/** A points limit typed in the filter bar, or null when it is blank or not a number. */
function limit(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function statusMatches(t: ViewTask, status: StatusFilter): boolean {
  const done = t.status === "done";
  switch (status) {
    case "all":
      return true;
    case "open":
      return !done;
    case "done":
      return done;
    case "ticked":
      return !done && t.agentSelected && !t.agentTicketUrl;
    case "with-agents":
      return !done && Boolean(t.agentTicketUrl);
  }
}

/** Does this one task match every filter set? */
export function matches(t: ViewTask, f: Filter): boolean {
  const text = f.text.trim().toLowerCase();
  if (text && !`${t.title}\n${t.notes ?? ""}`.toLowerCase().includes(text)) return false;
  if (f.priority !== "all" && t.priority !== f.priority) return false;
  if (!statusMatches(t, f.status)) return false;
  const min = limit(f.minPoints);
  const max = limit(f.maxPoints);
  if (min !== null && t.points < min) return false;
  if (max !== null && t.points > max) return false;
  if (f.creator !== "all" && t.ownerId !== f.creator) return false;
  return true;
}

/**
 * The tasks to show: every match, plus the parents (and their parents) of a
 * matching sub-task, so a sub-task is never shown out of context. The ids of
 * those kept only as context come back separately, so the screen can show
 * them dimmed. Order is kept.
 */
export function filterTasks<T extends ViewTask>(tasks: T[], f: Filter): { shown: T[]; contextOnly: Set<string> } {
  if (!isFiltering(f)) return { shown: tasks, contextOnly: new Set() };
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const matched = new Set(tasks.filter((t) => matches(t, f)).map((t) => t.id));
  const contextOnly = new Set<string>();
  for (const id of matched) {
    let parentId = byId.get(id)?.parentTaskId ?? null;
    // The seen-set stops a loop of parents (from another tool) running forever.
    const seen = new Set([id]);
    while (parentId && !seen.has(parentId) && byId.has(parentId)) {
      seen.add(parentId);
      if (!matched.has(parentId)) contextOnly.add(parentId);
      parentId = byId.get(parentId)?.parentTaskId ?? null;
    }
  }
  return { shown: tasks.filter((t) => matched.has(t.id) || contextOnly.has(t.id)), contextOnly };
}

/**
 * The tasks of one section (Open or Done), without a context-only parent
 * none of whose matching sub-tasks are in that section. Sections split on
 * status, so an open parent of a done sub-task would otherwise sit alone,
 * dimmed, in Open, and hide that section's "no tasks match" line.
 */
export function sectionTasks<T extends ViewTask>(shown: T[], contextOnly: Set<string>, inSection: (t: T) => boolean): T[] {
  let list = shown.filter(inSection);
  // Drop bare context parents until none is left; one pass per level of a deeper tree.
  for (;;) {
    const parents = new Set(list.map((t) => t.parentTaskId));
    const kept = list.filter((t) => !contextOnly.has(t.id) || parents.has(t.id));
    if (kept.length === list.length) return list;
    list = kept;
  }
}

/*
 * Dates are drawn twice, on the server (Vercel runs in UTC) and again in the
 * browser. Both must give the same text or React throws the page away and
 * redraws it, so they are fixed to Mountain time and US English, not left
 * to whichever clock and language each side happens to have. Some engines
 * put a narrow no-break space before "PM" and some a plain one, so every
 * space is made a plain one.
 */
const ZONE = "America/Denver";
const plain = (text: string) => text.replace(/\s/g, " ");
const yearIn = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric" }).format(d);

/** When a task was added, short, in Mountain time: "Oct 27" this year, "Oct 27, 2025" before. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const thisYear = yearIn(d) === yearIn(now);
  return plain(d.toLocaleDateString("en-US", { timeZone: ZONE, month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) }));
}

/** When a task was added, in full, in Mountain time: "Oct 27, 2026, 9:15 PM MT". */
export function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return plain(d.toLocaleString("en-US", { timeZone: ZONE, dateStyle: "medium", timeStyle: "short" })) + " MT";
}
