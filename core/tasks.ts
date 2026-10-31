/**
 * The task record, and the only path for creating and changing one.
 *
 * `app/`, scripts and any future member-built tool create and update tasks
 * through these functions, never by writing to the `tasks` table themselves.
 * Each call names its tool, and that name is stored on the record
 * (`tasks.tool`); a delete names its tool too, though no record is left to
 * carry it, so the store is handed the name. Points are not changed here:
 * that is `core/points.ts`.
 *
 * Every create, change and delete is also recorded and scored in the
 * engagement ledger, inside the same save (core/game.ts).
 *
 * Core does not know about Supabase. It talks to a `TaskStore`, which a
 * client supplies: a thin adapter that reads and writes rows and makes no
 * decisions of its own. The plain-words description of the table is
 * docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';
import { requirePointsValue } from './points.ts';
import { DEFAULT_ROLE, type RoleKey } from './members.ts';

/**
 * `proposed` is where a task added by a member who is not an admin starts:
 * it waits for an admin to approve it (`approveTask`), which makes it `todo`.
 * Until then its status cannot change and it cannot go to AI agents.
 */
export const TASK_STATUSES = ['proposed', 'todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Only an admin approves a proposed task. */
export function mayApproveTasks(role: RoleKey | null | undefined): boolean {
  return role === 'admin';
}

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
  /**
   * One task the caller may change, or null. Every member can read every
   * task (Dane, 2026-10-27), but this returns only the caller's own, so no
   * rule here ever acts on, or hangs a sub-task under, someone else's task.
   */
  get(id: string): Promise<Task | null>;
  /**
   * Apply `changes` to one task. When `guard` is given, apply them only if
   * everything it names still holds, and return null if not (someone else
   * changed the task first). Also null if there is no such task the caller
   * may change.
   */
  update(id: string, changes: TaskRowChanges, guard?: UpdateGuard): Promise<Task | null>;
  /**
   * Delete one task on behalf of `tool`. Its sub-tasks stay and become
   * top-level. Returns false if there is no such task the caller may delete.
   */
  remove(id: string, tool: string): Promise<boolean>;
  /**
   * Move one proposed task, anyone's, to todo on behalf of `tool`. Returns
   * null if there is no such task still proposed. The database lets only an
   * admin do this (`approve_task`), repeating core's rule.
   */
  approve(id: string, tool: string): Promise<Task | null>;
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

/** Returns the priority if it is one of the four, or throws. */
export function requirePriority(priority: unknown): TaskPriority {
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
 * A parent must be one of the caller's own tasks: the store's `get` only
 * returns those, so a task is never hung under someone else's. When `childId` is given (a task being moved), the parent may not be
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

/**
 * Create a task on behalf of `tool`, for a member whose role is
 * `creatorRole`. An admin's task starts as todo; anyone else's starts as
 * proposed and waits for an admin to approve it. A creator whose role is not
 * given is treated as a member with no role recorded: a contributor.
 */
export async function createTask(
  store: TaskStore,
  input: NewTask,
  tool: string,
  creatorRole: RoleKey = DEFAULT_ROLE,
): Promise<Task> {
  const admin = mayApproveTasks(creatorRole);
  const status = requireStatus(input.status ?? (admin ? 'todo' : 'proposed'));
  if (!admin && status !== 'proposed') {
    throw new CoreError('Only an admin can add a task that skips approval. Your task is added as Proposed.');
  }
  const row: NewTaskRow = {
    tool: requireTool(tool),
    title: requireTitle(input.title),
    notes: input.notes ?? null,
    status,
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
  // A proposed task keeps that status until an admin approves it, and no task goes back to it.
  let now: Task | null | undefined;
  const current = async () => (now === undefined ? (now = await store.get(id)) : now);
  if (changes.status !== undefined) {
    row.status = requireStatus(changes.status);
    if (row.status === 'proposed') throw new CoreError('A task is Proposed only when it is added; it cannot be moved back to Proposed.');
    if ((await current())?.status === 'proposed') {
      throw new CoreError('This task is still Proposed. An admin needs to approve it before its status can change.');
    }
  }
  if (changes.parentTaskId !== undefined) {
    row.parentTaskId = changes.parentTaskId ? await requireParent(store, changes.parentTaskId, id) : null;
  }
  if (changes.position !== undefined) row.position = requirePosition(changes.position);
  if (changes.priority !== undefined) row.priority = requirePriority(changes.priority);
  if (changes.agentSelected !== undefined) {
    if (typeof changes.agentSelected !== 'boolean') throw new CoreError('Ticking a task for AI agents is yes or no.');
    const status = changes.agentSelected ? row.status ?? (await current())?.status : undefined;
    if (status === 'done') throw new CoreError('A done task cannot be handed to AI agents. Reopen it first.');
    if (status === 'proposed') {
      throw new CoreError('A proposed task cannot be handed to AI agents until an admin approves it.');
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
 * An admin approves a proposed task on behalf of `tool`: it becomes todo, and
 * work on it can start. `approverRole` is the role of the member asking;
 * anyone but an admin is refused and nothing changes.
 */
export async function approveTask(store: TaskStore, id: string, approverRole: RoleKey, tool: string): Promise<Task> {
  const named = requireTool(tool);
  if (!mayApproveTasks(approverRole)) throw new CoreError('Only an admin can approve a proposed task. Nothing was changed.');
  const approved = await store.approve(id, named);
  if (!approved) throw new CoreError('This task is no longer proposed. It may already be approved, or it was deleted. Nothing was changed.');
  if (approved.status !== 'todo') throw new CoreError('The approval did not save. Nothing changed; try again.');
  return approved;
}

/**
 * Delete a task on behalf of `tool`. Its sub-tasks are kept and become
 * top-level, so no record of work disappears with its parent.
 */
export async function deleteTask(store: TaskStore, id: string, tool: string): Promise<void> {
  const named = requireTool(tool);
  if (!(await store.remove(id, named))) throw new CoreError(`No task ${id} was found that you may delete.`);
}
