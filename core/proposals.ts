/**
 * The proposal record, and the only path for creating and changing one.
 *
 * A proposal is an idea for a change that could become a task, if it passes
 * muster (Dane, 2026-11-02). It is its own record, apart from tasks ("a
 * proposal is really a different animal"), and to start it looks just like a
 * task: a title, notes, an owner, a status, a parent, points and a priority.
 * Later steps of the series reshape it and add the process that turns one
 * into a task; nothing here touches tasks or their Proposed status.
 *
 * Every member reads every proposal; a member changes and deletes only their
 * own. Each call names its tool, and that name is stored on the record
 * (`proposals.tool`). Core does not know about Supabase: it talks to a
 * `ProposalStore`, a thin adapter a client supplies. The plain-words
 * description of the table is docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';
import { requirePointsValue } from './points.ts';
import { requirePriority, type TaskPriority } from './tasks.ts';

/** The same open-to-done steps as a task, without a task's Proposed. */
export const PROPOSAL_STATUSES = ['todo', 'doing', 'done'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** One row of `proposals`, in core's own names. */
export interface Proposal {
  id: string;
  title: string;
  notes: string | null;
  ownerId: string;
  status: ProposalStatus;
  parentProposalId: string | null;
  points: number;
  position: number;
  priority: TaskPriority;
  /** The tool that last changed this record. */
  tool: string;
  createdAt: string;
  updatedAt: string;
}

/** The fields a store writes for a new proposal. The owner is the signed-in member. */
export interface NewProposalRow {
  title: string;
  notes: string | null;
  status: ProposalStatus;
  parentProposalId: string | null;
  points: number;
  position: number;
  priority: TaskPriority;
  tool: string;
}

/** The fields a store writes when a proposal changes. `tool` is always present. */
export type ProposalRowChanges = Partial<Omit<NewProposalRow, 'tool'>> & { tool: string };

/**
 * What core needs from storage. An adapter translates these calls to the
 * database and nothing more; every value it writes was decided here.
 */
export interface ProposalStore {
  insert(row: NewProposalRow): Promise<Proposal>;
  /** One proposal the caller may change (their own), or null. */
  get(id: string): Promise<Proposal | null>;
  /** Apply `changes` to one of the caller's proposals; null if there is no such proposal. */
  update(id: string, changes: ProposalRowChanges): Promise<Proposal | null>;
  /** Delete one of the caller's proposals. Its sub-proposals stay and become top-level. False if there is none. */
  remove(id: string): Promise<boolean>;
}

export interface NewProposal {
  title: string;
  notes?: string | null;
  status?: ProposalStatus;
  parentProposalId?: string | null;
  /** Defaults to 0. */
  points?: number;
  position?: number;
  /** Defaults to normal. */
  priority?: TaskPriority;
}

export type ProposalChanges = Partial<Omit<NewProposal, 'title'>> & { title?: string };

function requireTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new CoreError('A proposal needs a title, and it cannot be blank.');
  }
  return title.trim();
}

/** Notes that are only blank space are no notes. */
function cleanNotes(notes: unknown): string | null {
  if (notes === null || notes === undefined) return null;
  if (typeof notes !== 'string') throw new CoreError('A proposal’s notes must be words.');
  return notes.trim() ? notes.trim() : null;
}

function requireStatus(status: unknown): ProposalStatus {
  if (!PROPOSAL_STATUSES.includes(status as ProposalStatus)) {
    throw new CoreError(`A proposal's status must be one of ${PROPOSAL_STATUSES.join(', ')}; got "${String(status)}".`);
  }
  return status as ProposalStatus;
}

function requirePosition(position: unknown): number {
  if (typeof position !== 'number' || !Number.isFinite(position)) {
    throw new CoreError(`A proposal's position must be a number; got "${String(position)}".`);
  }
  return position;
}

/**
 * A parent must be one of the caller's own proposals (the store's `get` only
 * returns those). When `childId` is given, the parent may not be the
 * proposal itself or anything beneath it, so the tree never loops.
 */
async function requireParent(store: ProposalStore, parentId: string, childId?: string): Promise<string> {
  if (parentId === childId) throw new CoreError('A proposal cannot be its own parent.');
  const parent = await store.get(parentId);
  if (!parent) throw new CoreError(`No proposal ${parentId} was found that you may put a sub-proposal under.`);
  for (let up = parent.parentProposalId, seen = 0; up && seen < 1000; seen += 1) {
    if (up === childId) throw new CoreError('A proposal cannot be put under one of its own sub-proposals.');
    up = (await store.get(up))?.parentProposalId ?? null;
  }
  return parentId;
}

/** Make a proposal on behalf of `tool`. Any member may make one. */
export async function createProposal(store: ProposalStore, input: NewProposal, tool: string): Promise<Proposal> {
  const row: NewProposalRow = {
    tool: requireTool(tool),
    title: requireTitle(input.title),
    notes: cleanNotes(input.notes),
    status: requireStatus(input.status ?? 'todo'),
    parentProposalId: input.parentProposalId ? await requireParent(store, input.parentProposalId) : null,
    points: requirePointsValue(input.points ?? 0),
    position: requirePosition(input.position ?? 0),
    priority: requirePriority(input.priority ?? 'normal'),
  };
  return store.insert(row);
}

/** Change one of the caller's own proposals on behalf of `tool`. */
export async function updateProposal(store: ProposalStore, id: string, changes: ProposalChanges, tool: string): Promise<Proposal> {
  const row: ProposalRowChanges = { tool: requireTool(tool) };
  if (changes.title !== undefined) row.title = requireTitle(changes.title);
  if (changes.notes !== undefined) row.notes = cleanNotes(changes.notes);
  if (changes.status !== undefined) row.status = requireStatus(changes.status);
  if (changes.parentProposalId !== undefined) {
    row.parentProposalId = changes.parentProposalId ? await requireParent(store, changes.parentProposalId, id) : null;
  }
  if (changes.points !== undefined) row.points = requirePointsValue(changes.points);
  if (changes.position !== undefined) row.position = requirePosition(changes.position);
  if (changes.priority !== undefined) row.priority = requirePriority(changes.priority);
  const updated = await store.update(id, row);
  if (!updated) throw new CoreError(`No proposal ${id} was found that you may change. Only the member who made a proposal can change it.`);
  return updated;
}

/** Delete one of the caller's own proposals on behalf of `tool`. Its sub-proposals are kept and become top-level. */
export async function deleteProposal(store: ProposalStore, id: string, tool: string): Promise<void> {
  requireTool(tool);
  if (!(await store.remove(id))) {
    throw new CoreError(`No proposal ${id} was found that you may delete. Only the member who made a proposal can delete it.`);
  }
}
