/**
 * The task record, and the only path for creating and changing one.
 *
 * `app/`, scripts and any future member-built tool create and update tasks
 * through these functions, never by writing to the `tasks` table themselves.
 * Each call names its tool, and that name is stored on the record
 * (`tasks.tool`); a delete names its tool too, though no record is left to
 * carry it. Points are not changed here: that is `core/points.ts`.
 *
 * Core does not know about Supabase. It talks to a `TaskStore`, which a
 * client supplies: a thin adapter that reads and writes rows and makes no
 * decisions of its own. The plain-words description of the table is
 * docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';
import { requirePointsValue } from './points.ts';

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Most urgent first. The same four values as ClickUp, so they map one to one. */
export const TASK_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** One row of `tasks`, in core's own names. */
export interface Task {
  id: string;
  title: string;
  notes: string | null;
  ownerId: string;
  status: TaskStatus;
  parentTaskId: string | null;
  points: number;
  position: number;
  priority: TaskPriority;
  /** The member has ticked this task for AI agents to work on. */
  agentSelected: boolean;
  /** The Loop Queue ticket the task was handed to, or null if it has not been handed off. */
  agentTicketUrl: string | null;
  /** The tool that last changed this record. */
  tool: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** The fields a store writes for a new task. The owner is the signed-in member. */
export interface NewTaskRow {
  title: string;
  notes: string | null;
  status: TaskStatus;
  parentTaskId: string | null;
  points: number;
  position: number;
  priority: TaskPriority;
  agentSelected: boolean;
  agentTicketUrl: string | null;
  tool: string;
}

/** The fields a store writes when a task changes. `tool` is always present. */
export type TaskRowChanges = Partial<Omit<NewTaskRow, 'tool'>> & { tool: string };

/**
 * A condition an update only lands under, so two changes at once can never
 * silently overwrite each other. Each field given must still hold.
 */
export interface UpdateGuard {
  /** The task's points still equal this number. */
  points?: number;
  /** The task's status still equals this. */
  status?: TaskStatus;
  /** The task's ticket link still equals this (null: the task still has none). */
  agentTicketUrl?: string | null;
}

/**
 * What core needs from storage. An adapter translates these calls to the
 * database and nothing more; every value it writes was decided here.
 */
export interface TaskStore {
  insert(row: NewTaskRow): Promise<Task>;
  get(id: string): Promise<Task | null>;
  /**
   * Apply `changes` to one task. When `guard` is given, apply them only if
   * everything it names still holds, and return null if not (someone else
   * changed the task first). Also null if there is no such task the caller
   * may change.
   */
  update(id: string, changes: TaskRowChanges, guard?: UpdateGuard): Promise<Task | null>;
  /**
   * Delete one task. Its sub-tasks stay and become top-level. Returns false
   * if there is no such task the caller may delete.
   */
  remove(id: string): Promise<boolean>;
}

export interface NewTask {
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  parentTaskId?: string | null;
  /** Points the task starts with. Defaults to 0. */
  points?: number;
  position?: number;
  /** Defaults to normal. */
  priority?: TaskPriority;
}

/** What may change through `updateTask`. Points are deliberately absent. */
export interface TaskChanges {
  title?: string;
  notes?: string | null;
  status?: TaskStatus;
  parentTaskId?: string | null;
  position?: number;
  priority?: TaskPriority;
  /** Tick or untick the task for AI agents. A done task cannot be ticked. */
  agentSelected?: boolean;
}

function requireTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new CoreError('A task needs a title, and it cannot be blank.');
  }
  return title.trim();
}

function requireStatus(status: unknown): TaskStatus {
  if (!TASK_STATUSES.includes(status as TaskStatus)) {
    throw new CoreError(`A task's status must be one of ${TASK_STATUSES.join(', ')}; got "${String(status)}".`);
  }
  return status as TaskStatus;
}

function requirePriority(priority: unknown): TaskPriority {
  if (!TASK_PRIORITIES.includes(priority as TaskPriority)) {
    throw new CoreError(`A task's priority must be one of ${TASK_PRIORITIES.join(', ')}; got "${String(priority)}".`);
  }
  return priority as TaskPriority;
}

function requirePosition(position: unknown): number {
  if (typeof position !== 'number' || !Number.isFinite(position)) {
    throw new CoreError(`A task's position must be a number; got "${String(position)}".`);
  }
  return position;
}

/**
 * A parent must be a task the caller can see. The store only returns the
 * caller's own tasks, so this also stops a task being hung under someone
 * else's. When `childId` is given (a task being moved), the parent may not be
 * the task itself or anything beneath it, so the tree never loops.
 */
async function requireParent(store: TaskStore, parentTaskId: string, childId?: string): Promise<string> {
  if (parentTaskId === childId) throw new CoreError('A task cannot be its own parent.');
  const parent = await store.get(parentTaskId);
  if (!parent) throw new CoreError(`No task ${parentTaskId} was found that you may put a sub-task under.`);
  for (let up = parent.parentTaskId, seen = 0; up && seen < 1000; seen += 1) {
    if (up === childId) throw new CoreError('A task cannot be put under one of its own sub-tasks.');
    up = (await store.get(up))?.parentTaskId ?? null;
  }
  return parentTaskId;
}

/** Create a task on behalf of `tool`. */
export async function createTask(store: TaskStore, input: NewTask, tool: string): Promise<Task> {
  const row: NewTaskRow = {
    tool: requireTool(tool),
    title: requireTitle(input.title),
    notes: input.notes ?? null,
    status: requireStatus(input.status ?? 'todo'),
    parentTaskId: input.parentTaskId ? await requireParent(store, input.parentTaskId) : null,
    points: requirePointsValue(input.points ?? 0),
    position: requirePosition(input.position ?? 0),
    priority: requirePriority(input.priority ?? 'normal'),
    agentSelected: false,
    agentTicketUrl: null,
  };
  return store.insert(row);
}

/**
 * Change a task's title, notes, status, parent, position, priority or AI
 * tick on behalf of `tool`. Points cannot be changed here; use `setPoints` or
 * `awardPoints`.
 */
export async function updateTask(store: TaskStore, id: string, changes: TaskChanges, tool: string): Promise<Task> {
  const named = requireTool(tool);
  if ('points' in changes) {
    throw new CoreError('Points can only be changed with setPoints or awardPoints in core/points.ts, not with updateTask.');
  }
  const row: TaskRowChanges = { tool: named };
  if (changes.title !== undefined) row.title = requireTitle(changes.title);
  if (changes.notes !== undefined) row.notes = changes.notes;
  if (changes.status !== undefined) row.status = requireStatus(changes.status);
  if (changes.parentTaskId !== undefined) {
    row.parentTaskId = changes.parentTaskId ? await requireParent(store, changes.parentTaskId, id) : null;
  }
  if (changes.position !== undefined) row.position = requirePosition(changes.position);
  if (changes.priority !== undefined) row.priority = requirePriority(changes.priority);
  if (changes.agentSelected !== undefined) {
    if (typeof changes.agentSelected !== 'boolean') throw new CoreError('Ticking a task for AI agents is yes or no.');
    if (changes.agentSelected && (row.status ?? (await store.get(id))?.status) === 'done') {
      throw new CoreError('A done task cannot be handed to AI agents. Reopen it first.');
    }
    row.agentSelected = changes.agentSelected;
  }
  // Finishing a task takes it off the agents' list.
  if (row.status === 'done' && changes.agentSelected === undefined) row.agentSelected = false;
  // Reopening a task forgets any ticket it was handed to, so ticking it again
  // hands it over afresh. The ticket link itself only changes in core/agents.ts.
  if (row.status === 'todo') row.agentTicketUrl = null;
  const updated = await store.update(id, row);
  if (!updated) throw new CoreError(`No task ${id} was found that you may change.`);
  return updated;
}

/**
 * Delete a task on behalf of `tool`. Its sub-tasks are kept and become
 * top-level, so no record of work disappears with its parent.
 */
export async function deleteTask(store: TaskStore, id: string, tool: string): Promise<void> {
  requireTool(tool);
  if (!(await store.remove(id))) throw new CoreError(`No task ${id} was found that you may delete.`);
}
