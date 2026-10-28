/**
 * The game layer's first piece: the scoring rules (the kinds of engagement
 * and what each is worth, after Normie's `game_scoring`) and the engagement
 * ledger, in which every change a member makes is recorded and scored. Dane,
 * 2026-10-27: "nothing happens within WaveCenter that isn't tracked and
 * scored." He chose to start with rules + ledger, values fixed for now.
 *
 * Two rules hold everywhere:
 *
 * - **A tool says what happened; it never says what it is worth.** The points
 *   come from the scoring rule for the kind, so `recordEngagement` refuses
 *   any points value it is handed (docs/EXTENSION_MODEL.md, "Crediting").
 * - **A change and its engagement land together or not at all.** That is why
 *   the database records the engagement itself, inside the same save as the
 *   change (supabase/migrations/20261027120000_game_layer.sql): a website or
 *   script cannot make two separate writes all-or-nothing, and a change that
 *   skipped core would otherwise go unscored. The database applies exactly
 *   the rules in this file: `engagementKindForTask` says which kind a task
 *   change is, and `recordEngagement` scores it. Core's in-memory stores apply
 *   them through these same functions, so the tests prove the rules.
 *
 * Plain-words description of the two tables: docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';
import type { Task } from './tasks.ts';

/**
 * Every kind of engagement there is. Each one has a row in
 * `game_scoring_rules`; a test checks the migration seeds exactly these.
 */
export const ENGAGEMENT_KINDS = [
  'made_task',
  'changed_task',
  'finished_task',
  'deleted_task',
  'attached_file',
  'removed_file',
  'handed_to_agents',
  'switched_agents',
] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

/** One row of `game_scoring_rules`: a kind of engagement and what it is worth. */
export interface ScoringRule {
  kind: EngagementKind;
  /** What the member did, in a few words: "Made a task". */
  name: string;
  description: string;
  /** Exactly what counts. */
  criteria: string;
  points: number;
  /** Where the rule sits in the list on the Game page. */
  position: number;
}

/** One row of `engagements`: one thing one member did, and what it earned. */
export interface Engagement {
  id: string;
  /** Who is credited: the member whose task, file or setting it was. */
  memberId: string;
  kind: EngagementKind;
  /** Copied from the scoring rule at the moment it happened. */
  points: number;
  /** The tool that made the change. */
  tool: string;
  /** The task it was about, if any. Kept after the task is deleted. */
  taskId: string | null;
  createdAt: string;
}

/** The fields a store writes for a new engagement. Every one was decided here. */
export type NewEngagementRow = Omit<Engagement, 'id' | 'createdAt'>;

/** What a tool says happened. There is deliberately no points field. */
export interface EngagementInput {
  memberId: string;
  kind: string;
  tool: string;
  taskId?: string | null;
}

/** What core needs to record an engagement. An adapter decides nothing. */
export interface EngagementStore {
  rules(): Promise<ScoringRule[]>;
  insert(row: NewEngagementRow): Promise<Engagement>;
}

/** What the Game page reads: the rules, and the signed-in member's own ledger. */
export interface EngagementLedger {
  rules(): Promise<ScoringRule[]>;
  /** The member's most recent engagements, newest first. */
  latest(limit: number): Promise<Engagement[]>;
  /** The member's points total across their whole ledger. */
  total(): Promise<number>;
}

/**
 * The rules WaveCenter starts with, as the migration seeds them (a test keeps
 * the two in step). The values are placeholders until Dane, or later a
 * members' vote, sets them; for now they change only through a migration.
 */
export const STARTING_SCORING_RULES: readonly ScoringRule[] = [
  { kind: 'made_task', name: 'Made a task', description: 'Added a task to WaveCenter.', criteria: 'A new task is saved.', points: 1, position: 1 },
  { kind: 'changed_task', name: 'Changed a task', description: 'Edited a task: its title, details, priority, points, place or AI tick.', criteria: 'A saved change to a task that neither finishes it nor hands it to AI agents.', points: 1, position: 2 },
  { kind: 'finished_task', name: 'Finished a task', description: 'Marked a task done.', criteria: 'A task that was not done becomes done.', points: 5, position: 3 },
  { kind: 'deleted_task', name: 'Deleted a task', description: 'Removed a task.', criteria: 'A task is deleted. Its sub-tasks are kept and are not counted.', points: 1, position: 4 },
  { kind: 'attached_file', name: 'Attached a file', description: 'Added a file or picture to a task.', criteria: 'A file is saved on a task.', points: 1, position: 5 },
  { kind: 'removed_file', name: 'Removed a file', description: 'Took a file off a task.', criteria: 'A file is removed from a task on its own, not by deleting the task.', points: 1, position: 6 },
  { kind: 'handed_to_agents', name: 'Handed a task to AI agents', description: 'A task you ticked was filed for the AI agents to build.', criteria: 'A ticked task is given its Loop Queue ticket.', points: 1, position: 7 },
  { kind: 'switched_agents', name: 'Switched AI agents on or off', description: 'Flipped the Launch AI Agents switch.', criteria: 'The switch is saved, on or off.', points: 1, position: 8 },
];

/** Returns the kind if it is one WaveCenter knows, or throws a message a person can read. */
export function requireEngagementKind(kind: unknown): EngagementKind {
  if (!ENGAGEMENT_KINDS.includes(kind as EngagementKind)) {
    throw new CoreError(`"${String(kind)}" is not a kind of engagement WaveCenter scores, so nothing was saved.`);
  }
  return kind as EngagementKind;
}

/** What `kind` is worth under `rules`. A kind with no rule is refused, never scored as zero. */
export function scoreEngagement(rules: readonly ScoringRule[], kind: unknown): number {
  const known = requireEngagementKind(kind);
  const rule = rules.find((r) => r.kind === known);
  if (!rule) throw new CoreError(`There is no scoring rule for "${known}" yet, so nothing was saved.`);
  return rule.points;
}

/**
 * Record one engagement: look up what its kind is worth and write the row.
 * A tool cannot set the points; handing it any points value is refused.
 */
export async function recordEngagement(store: EngagementStore, input: EngagementInput): Promise<Engagement> {
  if (input && typeof input === 'object' && 'points' in input) {
    throw new CoreError('A tool cannot set what an engagement is worth; the scoring rules do. Nothing was saved.');
  }
  const tool = requireTool(input.tool);
  if (typeof input.memberId !== 'string' || !input.memberId) {
    throw new CoreError('An engagement must name the member it is credited to. Nothing was saved.');
  }
  const kind = requireEngagementKind(input.kind);
  const points = scoreEngagement(await store.rules(), kind);
  return store.insert({ memberId: input.memberId, kind, points, tool, taskId: input.taskId ?? null });
}

/**
 * Which kind of engagement a task change is. `before` is null for a new task,
 * `after` is null for a deleted one. Handing a task to agents (it gains a
 * ticket link) and finishing it (it becomes done) are their own kinds; any
 * other change is "changed a task". The database trigger mirrors this.
 */
export function engagementKindForTask(
  before: Pick<Task, 'status' | 'agentTicketUrl'> | null,
  after: Pick<Task, 'status' | 'agentTicketUrl'> | null,
): EngagementKind {
  if (!before) return 'made_task';
  if (!after) return 'deleted_task';
  if (after.agentTicketUrl && !before.agentTicketUrl) return 'handed_to_agents';
  if (after.status === 'done' && before.status !== 'done') return 'finished_task';
  return 'changed_task';
}

/** Add up a list of engagements' points. */
export function totalPoints(engagements: readonly Pick<Engagement, 'points'>[]): number {
  return engagements.reduce((sum, e) => sum + e.points, 0);
}
