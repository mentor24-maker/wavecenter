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
import { mayDo, type RoleKey } from './members.ts';
import { requirePointsValue } from './points.ts';
import { CoreError, requireTool } from './tool.ts';
import type { Task } from './tasks.ts';

/**
 * Every kind of engagement there is. Each one has a row in
 * `game_scoring_rules`; a test checks the migrations seed exactly these.
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
  'changed_profile',
  'voted_on_task',
] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

/**
 * One row of `game_scoring_rules`: a kind of engagement and what it is worth.
 * Its kind is one of `ENGAGEMENT_KINDS`, or a new action an admin added that
 * no part of WaveCenter records yet (see `isWired`).
 */
export interface ScoringRule {
  kind: string;
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
  /** Who is credited: the member whose task, file or setting it was, or who voted. */
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
 * The rules WaveCenter starts with, as the migrations seed them (a test keeps
 * the two in step). Since 2026-10-30 an admin changes their wording and
 * points on the Game management screen (`changeScoringRule`); a members' vote
 * comes later.
 */
export const STARTING_SCORING_RULES: readonly (ScoringRule & { kind: EngagementKind })[] = [
  { kind: 'made_task', name: 'Made a task', description: 'Added a task to WaveCenter.', criteria: 'A new task is saved.', points: 1, position: 1 },
  { kind: 'changed_task', name: 'Changed a task', description: 'Edited a task: its title, details, priority, points, place or AI tick.', criteria: 'A saved change to a task that neither finishes it nor hands it to AI agents.', points: 1, position: 2 },
  { kind: 'finished_task', name: 'Finished a task', description: 'Marked a task done.', criteria: 'A task that was not done becomes done.', points: 5, position: 3 },
  { kind: 'deleted_task', name: 'Deleted a task', description: 'Removed a task.', criteria: 'A task is deleted. Its sub-tasks are kept and are not counted.', points: 1, position: 4 },
  { kind: 'attached_file', name: 'Attached a file', description: 'Added a file or picture to a task.', criteria: 'A file is saved on a task.', points: 1, position: 5 },
  { kind: 'removed_file', name: 'Removed a file', description: 'Took a file off a task.', criteria: 'A file is removed from a task on its own, not by deleting the task.', points: 1, position: 6 },
  { kind: 'handed_to_agents', name: 'Handed a task to AI agents', description: 'A task you ticked was filed for the AI agents to build.', criteria: 'A ticked task is given its Loop Queue ticket.', points: 1, position: 7 },
  { kind: 'switched_agents', name: 'Switched AI agents on or off', description: 'Flipped the Launch AI Agents switch.', criteria: 'The switch is saved, on or off.', points: 1, position: 8 },
  { kind: 'changed_profile', name: 'Changed your profile', description: 'Saved your name, avatar, bio or who can see them.', criteria: 'Your profile is saved.', points: 1, position: 9 },
  { kind: 'voted_on_task', name: 'Voted on a task', description: 'Voted on what a task is worth or how urgent it is.', criteria: 'A vote on a task is cast, changed or withdrawn.', points: 1, position: 10 },
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

/**
 * Where each kind of engagement comes from, so anyone can confirm it (Dane,
 * 2026-10-30: "Each score should be directly associated with specific
 * functions that can be easily tested and confirmed"): the core function
 * that decides or makes the change, the database trigger that records it
 * inside the same save, and the test that proves it fires. A test checks
 * every function is exported where it says and every test exists by name.
 */
export interface ScoringTrigger {
  /** The core function, and the file it is exported from. */
  fn: string;
  file: string;
  /** The database function that records the engagement. */
  database: string;
  /** The test that proves it, and the file it is in. */
  test: string;
  testFile: string;
}

const TASK_CHANGE = {
  fn: 'engagementKindForTask',
  file: 'core/game.ts',
  database: 'tasks_score',
  test: 'making, changing, finishing and deleting a task each record exactly one engagement',
  testFile: 'core/game.test.ts',
};
const FILES_TEST = 'attaching and removing a file each record one engagement; deleting the task with its files records one';

export const SCORING_TRIGGERS: Record<EngagementKind, ScoringTrigger> = {
  made_task: TASK_CHANGE,
  changed_task: TASK_CHANGE,
  finished_task: TASK_CHANGE,
  deleted_task: TASK_CHANGE,
  attached_file: { fn: 'attachFile', file: 'core/files.ts', database: 'task_files_score', test: FILES_TEST, testFile: 'core/game.test.ts' },
  removed_file: { fn: 'removeFile', file: 'core/files.ts', database: 'task_files_score', test: FILES_TEST, testFile: 'core/game.test.ts' },
  handed_to_agents: {
    ...TASK_CHANGE,
    test: 'handing a task to agents is its own kind, credited to the member, naming the hand-off lane',
  },
  switched_agents: {
    fn: 'setAgentsOn', file: 'core/agents.ts', database: 'member_settings_score',
    test: 'flipping the AI agents switch records one engagement each time', testFile: 'core/game.test.ts',
  },
  changed_profile: {
    fn: 'saveProfile', file: 'core/profiles.ts', database: 'member_profiles_score',
    test: 'saving a profile records one engagement each time', testFile: 'core/game.test.ts',
  },
  voted_on_task: {
    fn: 'castVote', file: 'core/votes.ts', database: 'task_votes_apply',
    test: 'every vote cast, changed or withdrawn is scored for the voter', testFile: 'core/votes.test.ts',
  },
};

/**
 * Is something in WaveCenter wired to record this kind? Only the kinds in
 * `ENGAGEMENT_KINDS` are. A new action an admin adds stays inactive, earning
 * nothing, until an agent wires it to a function, a trigger and a test
 * (Dane, 2026-10-30, option B).
 */
export function isWired(kind: string): kind is EngagementKind {
  return ENGAGEMENT_KINDS.includes(kind as EngagementKind);
}

/** The longest name, and the longest description or criteria, a rule may have. The migration checks the same. */
export const RULE_NAME_MAX = 80;
export const RULE_TEXT_MAX = 500;

/** The parts of a rule an admin may change: its wording and what it is worth. */
export type RuleFields = Pick<ScoringRule, 'name' | 'description' | 'criteria' | 'points'>;

/** Who is asking to manage the rules: their role, and the grants the database holds if they were read. */
export interface GameActor {
  role: RoleKey | null | undefined;
  grants?: Readonly<Record<string, readonly string[]>>;
}

/** What core needs from storage to manage the rules. Every value it writes was checked here. */
export interface ScoringRuleStore {
  rules(): Promise<ScoringRule[]>;
  /** Write a rule's wording and points. Returns the rule as stored, or null if nothing was written. */
  update(kind: string, fields: RuleFields, tool: string): Promise<ScoringRule | null>;
  /** Add a new rule at the end of the list. Returns it as stored, or null if nothing was written. */
  add(kind: string, fields: RuleFields, tool: string): Promise<ScoringRule | null>;
}

/** May this member change the scoring rules? Only a role with "Manage game scoring" may (admin, to start). */
export function mayManageScoring(actor: GameActor): boolean {
  return mayDo(actor.role, 'game.edit', actor.grants);
}

function text(value: unknown, what: string, max: number): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new CoreError(`The ${what} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new CoreError(`The ${what} can be at most ${max} characters; this one is ${trimmed.length}.`);
  return trimmed;
}

/** A rule's wording and points, trimmed and checked, or a message a person can read. */
export function checkRuleFields(input: { name?: unknown; description?: unknown; criteria?: unknown; points?: unknown }): RuleFields {
  const name = text(input.name, 'name', RULE_NAME_MAX);
  if (!name) throw new CoreError('Every action needs a name, such as "Made a task". Nothing was saved.');
  const description = text(input.description, 'description', RULE_TEXT_MAX);
  const criteria = text(input.criteria, 'criteria', RULE_TEXT_MAX);
  let points: number;
  try {
    points = requirePointsValue(input.points);
  } catch (err) {
    throw new CoreError(`${(err as Error).message} Nothing was saved.`);
  }
  return { name, description, criteria, points };
}

/**
 * The kind a new action gets from its name: lower-case letters, words joined
 * by "_" ("Wrote a comment" → "wrote_a_comment"). The database allows only
 * these characters in a kind.
 */
export function kindFromName(name: string): string {
  const kind = name.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  if (!kind) throw new CoreError('An action\'s name needs at least one letter (a to z). Nothing was saved.');
  return kind;
}

function requireManager(actor: GameActor): void {
  if (!mayManageScoring(actor)) throw new CoreError('Only an admin can manage the game scoring. Nothing was saved.');
}

function sameFields(rule: ScoringRule, fields: RuleFields): boolean {
  return rule.name === fields.name && rule.description === fields.description && rule.criteria === fields.criteria && rule.points === fields.points;
}

/** What one rule change did. */
export interface ScoringRuleChange {
  before: ScoringRule;
  after: ScoringRule;
  tool: string;
}

/**
 * The only way a scoring rule changes. Refused unless the actor may manage
 * scoring, the rule exists and the new wording and points pass
 * `checkRuleFields`. The change counts from the very next engagement; what
 * was already earned keeps the points it was given. Throws if what comes back
 * is not what was asked for, so a failed save is never reported as saved.
 */
export async function changeScoringRule(
  store: ScoringRuleStore,
  actor: GameActor,
  change: { kind: string; name?: unknown; description?: unknown; criteria?: unknown; points?: unknown },
  tool: string,
): Promise<ScoringRuleChange> {
  const named = requireTool(tool);
  requireManager(actor);
  const fields = checkRuleFields(change);
  const before = (await store.rules()).find((r) => r.kind === change.kind);
  if (!before) throw new CoreError(`There is no action "${String(change.kind)}" to change. Reload the page.`);
  const after = await store.update(before.kind, fields, named);
  if (!after || !sameFields(after, fields)) throw new CoreError('The change did not save. Nothing changed; try again.');
  return { before, after, tool: named };
}

/**
 * Add a new action to the scoring rules. Its kind comes from its name
 * (`kindFromName`); neither the kind nor the name may be taken. It is inactive until an agent wires
 * it into WaveCenter (`isWired`): until then nothing records it, so it earns
 * nothing.
 */
export async function addScoringRule(
  store: ScoringRuleStore,
  actor: GameActor,
  input: { name?: unknown; description?: unknown; criteria?: unknown; points?: unknown },
  tool: string,
): Promise<ScoringRule> {
  const named = requireTool(tool);
  requireManager(actor);
  const fields = checkRuleFields(input);
  const kind = kindFromName(fields.name);
  const sameName = (r: ScoringRule) => r.name.trim().toLowerCase() === fields.name.toLowerCase();
  const taken = (await store.rules()).find((r) => r.kind === kind || sameName(r));
  if (taken) throw new CoreError(`There is already an action "${taken.name}" (${taken.kind}). Change that one, or pick another name. Nothing was saved.`);
  const added = await store.add(kind, fields, named);
  if (!added || added.kind !== kind || !sameFields(added, fields)) throw new CoreError('The new action did not save. Nothing changed; try again.');
  return added;
}
