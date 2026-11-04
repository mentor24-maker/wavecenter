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
  'posted_a_comment',
  'edited_a_comment',
  'deleted_a_comment',
  'send_a_message_to_another_member',
  'made_a_team',
  'changed_a_team',
  'deleted_a_team',
  'added_a_member_to_a_team',
  'removed_a_member_from_a_team',
  'changed_a_member_s_role',
  'approved_a_proposed_task',
  'joined_wavecenter',
  'changed_a_scoring_rule',
  'added_a_scoring_action',
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
  /** Its four factor scores for the formula (`granularPoints`); null or absent = not scored yet. */
  factors?: ScoringFactors | null;
  /** Why it got each factor score, one sentence each; absent = none written yet. */
  reasons?: FactorReasons | null;
}

/** One row of `engagements`: one thing one member did, and what it earned. */
export interface Engagement {
  id: string;
  /** Who is credited: the member whose task, file or setting it was, or who voted or changed a team. */
  memberId: string;
  kind: EngagementKind;
  /** Copied from the scoring rule at the moment it happened. */
  points: number;
  /** The tool that made the change. */
  tool: string;
  /** The task it was about, if any. Kept after the task is deleted. */
  taskId: string | null;
  /**
   * Set only on a correction row a rescore added (`applyRescore`): the
   * rescore it belongs to. Such a row is not an action, so counts of actions
   * leave it out; its points still count towards the total.
   */
  rescoreId?: string | null;
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
  { kind: 'posted_a_comment', name: 'Posted a comment', description: "Wrote a comment in a task's discussion.", criteria: 'A new comment is saved on a task.', points: 1, position: 11 },
  // Listed by the sweep migration (20261102120000), so on a fresh database it
  // sits after the ten above and "Posted a comment".
  { kind: 'edited_a_comment', name: 'Edited a comment', description: 'Changed the words of a comment you wrote.', criteria: 'A saved change to a comment.', points: 1, position: 12 },
  // Listed by the sweep migration too (third of its rows).
  { kind: 'deleted_a_comment', name: 'Deleted a comment', description: 'Removed a comment you wrote.', criteria: 'A comment is deleted on its own, not by deleting its task.', points: 1, position: 13 },
  // Listed by 20261102120000_scoring_actions_sweep.sql, fourth of its rows,
  // so a fresh database puts it at 14.
  { kind: 'send_a_message_to_another_member', name: 'Send a message to another member', description: 'Sent a message to a member from Members or Your profile.', criteria: 'A message is saved for its recipient.', points: 1, position: 14 },
  { kind: 'made_a_team', name: 'Made a team', description: 'Started a new team on the Teams page.', criteria: 'A new team is saved.', points: 1, position: 15 },
  // Listed by the sweep migration too, sixth of its rows.
  { kind: 'changed_a_team', name: 'Changed a team', description: "Edited a team's name or details.", criteria: 'A saved change to a team.', points: 1, position: 16 },
  { kind: 'deleted_a_team', name: 'Deleted a team', description: 'Removed a team.', criteria: 'A team is deleted.', points: 1, position: 17 },
  // Listed by the sweep (20261102120000_scoring_actions_sweep.sql) after the ten above, eighth of its rows.
  { kind: 'added_a_member_to_a_team', name: 'Added a member to a team', description: 'Put a member on a team.', criteria: 'A member joins a team they were not on.', points: 1, position: 18 },
  // Listed by the sweep (20261102120000_scoring_actions_sweep.sql) after the ten above, ninth of its rows.
  { kind: 'removed_a_member_from_a_team', name: 'Removed a member from a team', description: 'Took a member off a team.', criteria: 'A member leaves a team, not by the team being deleted.', points: 1, position: 19 },
  // Listed by the sweep (20261102120000_scoring_actions_sweep.sql) after the ten above, tenth of its rows.
  { kind: 'changed_a_member_s_role', name: "Changed a member's role", description: 'Gave a member a different role on the Members page.', criteria: "A member's role is saved as a different role.", points: 1, position: 20 },
  // Listed by the sweep (20261102120000_scoring_actions_sweep.sql) after the ten above, eleventh of its rows.
  { kind: 'approved_a_proposed_task', name: 'Approved a proposed task', description: 'Approved a task a member proposed, so it joins the list.', criteria: 'A proposed task becomes a to-do. Credited to the admin who approved it.', points: 1, position: 21 },
  // Listed by the sweep (20261102120000_scoring_actions_sweep.sql) after the ten above, twelfth of its rows.
  { kind: 'joined_wavecenter', name: 'Joined WaveCenter', description: 'Made a WaveCenter account.', criteria: "A new member's account is created.", points: 1, position: 22 },
  // Listed by the sweep (20261102120000_scoring_actions_sweep.sql) after the ten above, thirteenth of its rows.
  { kind: 'changed_a_scoring_rule', name: 'Changed a scoring rule', description: 'Edited an action\'s name, description, criteria or points on Game > Manage.', criteria: 'A saved change to a scoring rule.', points: 1, position: 23 },
  // Listed by the sweep (20261102120000_scoring_actions_sweep.sql) after the ten above, fourteenth of its rows.
  { kind: 'added_a_scoring_action', name: 'Added a scoring action', description: 'Added a new action to the list on Game > Manage.', criteria: 'A new scoring rule is saved.', points: 1, position: 24 },
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
 *
 * A task earns "Finished a task" once. `finishedBefore` says it already has,
 * so finishing it again after reopening it is only a change: otherwise done,
 * reopen, done pays the finish every time round (the first anti-farming step,
 * docs/GRANULAR_SCORING_ALGORITHM.md, "Safeguards the formula cannot give").
 */
export function engagementKindForTask(
  before: Pick<Task, 'status' | 'agentTicketUrl'> | null,
  after: Pick<Task, 'status' | 'agentTicketUrl'> | null,
  finishedBefore = false,
): EngagementKind {
  if (!before) return 'made_task';
  if (!after) return 'deleted_task';
  if (after.agentTicketUrl && !before.agentTicketUrl) return 'handed_to_agents';
  if (after.status === 'done' && before.status !== 'done' && !finishedBefore) return 'finished_task';
  return 'changed_task';
}

/**
 * The task fields a save stamps for itself: when it happened, which tool did
 * it, and the finish time, which only moves with the status. A save that
 * differs only in these changed nothing.
 */
const TASK_SAVE_STAMPS: readonly (keyof Task)[] = ['updatedAt', 'tool', 'completedAt'];

/**
 * Did this save change the task? A save with nothing different is not an
 * action, so it records no engagement and earns nothing. The database
 * trigger mirrors this.
 */
export function taskChanged(before: Task, after: Task): boolean {
  return (Object.keys(after) as (keyof Task)[]).some(
    (key) => !TASK_SAVE_STAMPS.includes(key) && before[key] !== after[key],
  );
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
    test: 'saving a profile records one engagement each time it changes, and none when nothing changed', testFile: 'core/game.test.ts',
  },
  voted_on_task: {
    fn: 'castVote', file: 'core/votes.ts', database: 'task_votes_apply',
    test: 'every vote cast, changed or withdrawn is scored for the voter', testFile: 'core/votes.test.ts',
  },
  posted_a_comment: {
    fn: 'addComment', file: 'core/comments.ts', database: 'task_comments_score',
    test: 'posting a comment records one engagement, credited to the member who wrote it, naming the tool', testFile: 'core/comments.test.ts',
  },
  edited_a_comment: {
    fn: 'editComment', file: 'core/comments.ts', database: 'task_comments_score_edit',
    test: 'every edit that changes the words of a comment is scored once, for the member who wrote it', testFile: 'core/comments.test.ts',
  },
  deleted_a_comment: {
    fn: 'removeComment', file: 'core/comments.ts', database: 'task_comments_score_delete',
    test: 'deleting a comment records one engagement for its writer, naming the tool; deleting its task records none for it',
    testFile: 'core/comments.test.ts',
  },
  send_a_message_to_another_member: {
    fn: 'sendMessage', file: 'core/messages.ts', database: 'messages_score',
    test: 'each message sent to another member records one engagement for the sender, naming its tool', testFile: 'core/messages.test.ts',
  },
  made_a_team: {
    fn: 'createTeam', file: 'core/teams.ts', database: 'teams_score',
    test: 'making a team records one engagement, credited to the member who made it, naming the tool', testFile: 'core/teams.test.ts',
  },
  changed_a_team: {
    fn: 'updateTeam', file: 'core/teams.ts', database: 'teams_score_change',
    test: 'changing a team records one engagement for the member who changed it; a save that changes nothing records none',
    testFile: 'core/teams.test.ts',
  },
  deleted_a_team: {
    fn: 'deleteTeam', file: 'core/teams.ts', database: 'teams_score_delete',
    test: 'deleting a team records one engagement, credited to the member who deleted it, naming the tool', testFile: 'core/teams.test.ts',
  },
  added_a_member_to_a_team: {
    fn: 'addTeamMember', file: 'core/teams.ts', database: 'team_members_score',
    test: 'adding a member to a team records one engagement, credited to the member who added them', testFile: 'core/teams.test.ts',
  },
  removed_a_member_from_a_team: {
    fn: 'removeTeamMember', file: 'core/teams.ts', database: 'team_members_score_removed',
    test: 'removing a member from a team records one engagement, credited to the member who removed them', testFile: 'core/teams.test.ts',
  },
  changed_a_member_s_role: {
    fn: 'setMemberRole', file: 'core/members.ts', database: 'member_roles_score',
    test: 'changing a member role records one engagement, credited to the admin who changed it, not the member', testFile: 'core/members.test.ts',
  },
  approved_a_proposed_task: {
    fn: 'approveTask', file: 'core/tasks.ts', database: 'tasks_score_approval',
    test: 'approving a proposed task records one engagement, credited to the admin who approved it', testFile: 'core/tasks.test.ts',
  },
  joined_wavecenter: {
    fn: 'newAccountData', file: 'core/accounts.ts', database: 'auth_users_score',
    test: 'joining WaveCenter records one engagement, credited to the new member, naming the tool', testFile: 'core/game.test.ts',
  },
  changed_a_scoring_rule: {
    fn: 'changeScoringRule', file: 'core/game.ts', database: 'game_scoring_rules_score',
    test: 'changing a scoring rule records one engagement, credited to the admin who changed it', testFile: 'core/game.test.ts',
  },
  added_a_scoring_action: {
    fn: 'addScoringRule', file: 'core/game.ts', database: 'game_scoring_rules_score_added',
    test: 'adding a scoring action records one engagement, credited to the admin who added it', testFile: 'core/game.test.ts',
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
  /** Add a new rule at the end of the list, with its factors and reasons or none. Returns it as stored, or null if nothing was written. */
  add(kind: string, fields: RuleFields, tool: string, factors?: ScoringFactors | null, reasons?: FactorReasons): Promise<ScoringRule | null>;
  /** Write a rule's four factors (null clears them). Returns the rule as stored, or null if nothing was written. */
  setFactors(kind: string, factors: ScoringFactors | null, tool: string): Promise<ScoringRule | null>;
  /** Write why a rule got each factor score (null = none written). Returns the rule as stored, or null if nothing was written. */
  setReasons(kind: string, reasons: FactorReasons, tool: string): Promise<ScoringRule | null>;
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
 * The database scores a change to the wording or points for the admin who
 * made it (`changed_a_scoring_rule`,
 * supabase/migrations/20261102185000_score_changed_a_scoring_rule.sql); a save
 * that changes nothing is not scored.
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
 * nothing. Its four factors may be given now (`checkFactors`), so the
 * Admin page's batch can work out its points; without them it is "not scored yet".
 * Adding it is itself scored, for the admin who added it
 * (`added_a_scoring_action`,
 * supabase/migrations/20261102190000_score_added_a_scoring_action.sql).
 */
export async function addScoringRule(
  store: ScoringRuleStore,
  actor: GameActor,
  input: { name?: unknown; description?: unknown; criteria?: unknown; points?: unknown; factors?: unknown; reasons?: unknown },
  tool: string,
): Promise<ScoringRule> {
  const named = requireTool(tool);
  requireManager(actor);
  const fields = checkRuleFields(input);
  const factors = checkFactors(input.factors);
  const reasons = checkReasons(input.reasons);
  const kind = kindFromName(fields.name);
  const sameName = (r: ScoringRule) => r.name.trim().toLowerCase() === fields.name.toLowerCase();
  const taken = (await store.rules()).find((r) => r.kind === kind || sameName(r));
  if (taken) throw new CoreError(`There is already an action "${taken.name}" (${taken.kind}). Change that one, or pick another name. Nothing was saved.`);
  const added = await store.add(kind, fields, named, factors, reasons);
  if (!added || added.kind !== kind || !sameFields(added, fields) || !sameFactors(added.factors, factors) || !sameReasons(added.reasons, reasons)) throw new CoreError('The new action did not save. Nothing changed; try again.');
  return added;
}

/**
 * Granular scoring by formula (docs/GRANULAR_SCORING_ALGORITHM.md). Each
 * action is scored on four factors; the formula turns them into points. The
 * Admin page's batch job runs it over every action and puts the results live
 * only when an admin accepts them (Dane, 2026-11-01: "a batch job that I can
 * kick off from the Admin page"). No AI service is called: it is arithmetic.
 */
export interface ScoringFactors {
  /** E, how much of the member's time and attention it takes. */
  effort: number;
  /** V, what it does for the project and other members. Counted twice. */
  value: number;
  /** R, how often a member genuinely does it. */
  rarity: number;
  /** F, how easily it can be repeated just to collect points. Scored and stored for anti-farming work; not part of the formula. */
  farmRisk: number;
}
export type FactorKey = keyof ScoringFactors;

export const FACTOR_KEYS: readonly FactorKey[] = ['effort', 'value', 'rarity', 'farmRisk'];

/**
 * Why an action got each of its factor scores, one sentence per factor; null
 * = no reason written yet. Shown on the Admin page; never read by the formula.
 */
export type FactorReasons = Record<FactorKey, string | null>;

export const NO_REASONS: FactorReasons = { effort: null, value: null, rarity: null, farmRisk: null };

/** The longest a factor's reason may be. The database checks the same (20261103140000_edit_factor_reasons.sql). */
export const REASON_MAX = 300;

/** The highest score each factor may have; the lowest is 0. The migration checks the same. */
export const FACTOR_MAX: Record<FactorKey, number> = { effort: 3, value: 3, rarity: 2, farmRisk: 3 };

/**
 * Each factor's name, letter, what it measures, how it moves the points
 * (`effect`, matching `granularPoints`) and the plain test for each level,
 * word for word from the document.
 */
export const FACTOR_TESTS: Record<FactorKey, { name: string; letter: string; measures: string; effect: string; levels: readonly string[] }> = {
  effort: {
    name: 'Effort', letter: 'E',
    measures: 'How much of the member\'s time and attention the action takes.',
    effect: 'Added once.',
    levels: [
      'One click or one tick.',
      'A short form or a few words: under a minute.',
      'Writing or choosing that takes several minutes of thought.',
      'The click records hours of work done outside it (finishing a task).',
    ],
  },
  value: {
    name: 'Value', letter: 'V',
    measures: 'What the action does for the project and for other members.',
    effect: 'Counted twice, because it is the reason the game layer exists.',
    levels: [
      'Nothing for anyone else: a personal setting.',
      'Tidies up, or helps one other member.',
      'Adds something the other members read, use or rely on.',
      'Delivers finished work the project planned.',
    ],
  },
  rarity: {
    name: 'Rarity', letter: 'R',
    measures: 'How often a member genuinely does it. A rare action is a bigger moment.',
    effect: 'Added once.',
    levels: ['Many times a day.', 'A few times a week.', 'A handful of times ever, or once (joining).'],
  },
  farmRisk: {
    name: 'Farm risk', letter: 'F',
    measures: 'How easily the action can be repeated just to collect points.',
    effect: 'Scored and kept for later anti-farming work, but it does not change the points.',
    levels: [
      'Cannot be repeated (once per member), or costs real work every time.',
      'Repeatable, but each time needs something real from someone else.',
      'Repeatable in seconds with no real input, but it cannot undo itself.',
      'Repeatable in seconds and it loops: a switch flipped back, a save of the same thing, or an action paired with its own undo (make / delete).',
    ],
  },
};

function factor(value: unknown, key: FactorKey): number {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > FACTOR_MAX[key]) {
    throw new CoreError(`${FACTOR_TESTS[key].name} must be a whole number from 0 to ${FACTOR_MAX[key]}. Nothing was saved.`);
  }
  return n;
}

/**
 * Four factors, checked, or null when none is given ("not scored yet"). Some
 * but not all of them is refused: half-scored would be read as a score.
 */
export function checkFactors(input: unknown): ScoringFactors | null {
  if (input == null) return null;
  if (typeof input !== 'object') throw new CoreError('The factors must be effort, value, rarity and farm risk. Nothing was saved.');
  const given = input as Record<string, unknown>;
  const blank = (v: unknown) => v == null || (typeof v === 'string' && !v.trim());
  const missing = FACTOR_KEYS.filter((k) => blank(given[k]));
  if (missing.length === FACTOR_KEYS.length) return null;
  if (missing.length) {
    throw new CoreError(`Score all four factors or none; ${missing.map((k) => FACTOR_TESTS[k].name.toLowerCase()).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing. Nothing was saved.`);
  }
  return { effort: factor(given.effort, 'effort'), value: factor(given.value, 'value'), rarity: factor(given.rarity, 'rarity'), farmRisk: factor(given.farmRisk, 'farmRisk') };
}

/**
 * The reasons behind the four factor scores, each trimmed and checked; a
 * blank or missing one is null ("no reason written yet"). One over
 * REASON_MAX is refused, and nothing is saved.
 */
export function checkReasons(input: unknown): FactorReasons {
  if (input == null) return { ...NO_REASONS };
  if (typeof input !== 'object') throw new CoreError('The reasons must be effort, value, rarity and farm risk. Nothing was saved.');
  const given = input as Record<string, unknown>;
  const reasons = { ...NO_REASONS };
  for (const k of FACTOR_KEYS) {
    try {
      reasons[k] = text(given[k], `${FACTOR_TESTS[k].name} reason`, REASON_MAX) || null;
    } catch (err) {
      throw new CoreError(`${(err as Error).message} Nothing was saved.`);
    }
  }
  return reasons;
}

function sameReasons(a: FactorReasons | null | undefined, b: FactorReasons): boolean {
  const stored = { ...NO_REASONS, ...a };
  return FACTOR_KEYS.every((k) => stored[k] === b[k]);
}

function sameFactors(a: ScoringFactors | null | undefined, b: ScoringFactors | null): boolean {
  if (!a || !b) return !a && !b;
  return FACTOR_KEYS.every((k) => a[k] === b[k]);
}

/**
 * The formula: Points = 1 + E + 2 × V + R, so every action scores at least 1.
 * Farm risk is still required and stored, but does not change the points
 * (Dane, 2026-11-02: "Drop F at this level"); anti-farming work comes later.
 */
export function granularPoints(factors: ScoringFactors): number {
  const f = checkFactors(factors);
  if (!f) throw new CoreError('An action needs all four factors before the formula can score it.');
  return 1 + f.effort + 2 * f.value + f.rarity;
}

/**
 * The formula's arithmetic for one action, written out the way the Admin
 * page explains it: "1 + 1 + 2 × 2 + 0 = 6". It ends in `granularPoints`,
 * so the total shown is always the one the formula uses.
 */
export function granularWorking(factors: ScoringFactors): string {
  const { effort, value, rarity } = factors;
  return `1 + ${effort} + 2 × ${value} + ${rarity} = ${granularPoints(factors)}`;
}

/** Worked examples for the Admin page, from docs/GRANULAR_SCORING_ALGORITHM.md. A test checks each `points` against `granularPoints`. */
export const FORMULA_EXAMPLES: readonly { action: string; factors: ScoringFactors; points: number; why: string }[] = [
  {
    action: 'Voted on a task', factors: { effort: 1, value: 2, rarity: 0, farmRisk: 3 }, points: 6,
    why: 'A judgment of a few seconds that other members rely on (it sets what a task is worth), done many times a day. A vote can be changed forever, so Farm risk is 3, but that does not lower the points.',
  },
  {
    action: 'Finished a task', factors: { effort: 3, value: 3, rarity: 1, farmRisk: 3 }, points: 11,
    why: 'Records hours of real finished work the project planned: the most valuable action. Reopening and finishing again loops, which anti-farming work will deal with separately.',
  },
  {
    action: 'Joined WaveCenter', factors: { effort: 1, value: 1, rarity: 2, farmRisk: 1 }, points: 6,
    why: 'Once per member, so it is as rare as an action gets. Accounts are cheap to make, so Farm risk is 1, not 0.',
  },
  {
    action: 'Switched AI agents on or off', factors: { effort: 0, value: 0, rarity: 0, farmRisk: 3 }, points: 1,
    why: 'A personal switch that flips back and forth: it scores 0 on every counted factor, so it earns only the starting 1, the lowest any action can score.',
  },
];

/** One row of the batch's results: what an action is worth now and what the formula says. */
export interface GranularProposal {
  kind: string;
  name: string;
  factors: ScoringFactors | null;
  /** Why it got each factor score, as stored; a reason not written yet is null. */
  reasons: FactorReasons;
  now: number;
  /** What the formula gives, or null when the action is not scored yet (it is left alone). */
  proposed: number | null;
  /** True only when it is scored and the formula gives a different value. */
  changes: boolean;
}

/** The batch: for every rule, today's points and the formula's. Saves nothing. */
export function proposeGranularPoints(rules: readonly ScoringRule[]): GranularProposal[] {
  return rules.map((r) => {
    const factors = r.factors ?? null;
    const proposed = factors ? granularPoints(factors) : null;
    const reasons = { ...NO_REASONS, ...r.reasons };
    return { kind: r.kind, name: r.name, factors, reasons, now: r.points, proposed, changes: proposed !== null && proposed !== r.points };
  });
}

/** Run the batch for an admin. Refused for anyone else, though it saves nothing. */
export async function recalculateGranularPoints(store: Pick<ScoringRuleStore, 'rules'>, actor: GameActor): Promise<GranularProposal[]> {
  if (!mayManageScoring(actor)) throw new CoreError('Only an admin can recalculate the action points.');
  return proposeGranularPoints(await store.rules());
}

/**
 * Change one rule's four factors (Game → Manage). Only an admin may; the new
 * factors change no points until the batch's results are put live.
 */
export async function changeScoringFactors(
  store: ScoringRuleStore,
  actor: GameActor,
  change: { kind: string; factors?: unknown },
  tool: string,
): Promise<ScoringRule> {
  const named = requireTool(tool);
  requireManager(actor);
  const factors = checkFactors(change.factors);
  const before = (await store.rules()).find((r) => r.kind === change.kind);
  if (!before) throw new CoreError(`There is no action "${String(change.kind)}" to change. Reload the page.`);
  const after = await store.setFactors(before.kind, factors, named);
  if (!after || !sameFactors(after.factors, factors)) throw new CoreError('The factors did not save. Nothing changed; try again.');
  return after;
}

/**
 * Change why an action got its factor scores (Game → Manage). Only an admin
 * may. A factor left out of `reasons` keeps its stored reason; a blank one is
 * cleared. Each is checked by `checkReasons`. The reasons change no points.
 */
export async function changeFactorReasons(
  store: ScoringRuleStore,
  actor: GameActor,
  change: { kind: string; reasons?: unknown },
  tool: string,
): Promise<ScoringRule> {
  const named = requireTool(tool);
  requireManager(actor);
  if (change.reasons != null && typeof change.reasons !== 'object') throw new CoreError('The reasons must be effort, value, rarity and farm risk. Nothing was saved.');
  const given = (change.reasons ?? {}) as Record<string, unknown>;
  const before = (await store.rules()).find((r) => r.kind === change.kind);
  if (!before) throw new CoreError(`There is no action "${String(change.kind)}" to change. Reload the page.`);
  const stored = { ...NO_REASONS, ...before.reasons };
  const reasons = checkReasons(Object.fromEntries(FACTOR_KEYS.map((k) => [k, k in given ? given[k] : stored[k]])));
  const after = await store.setReasons(before.kind, reasons, named);
  if (!after || !sameReasons(after.reasons, reasons)) throw new CoreError('The reasons did not save. Nothing changed; try again.');
  return after;
}

/** One row the admin accepted: the action, and the points the batch showed now and proposed. */
export interface AcceptedProposal {
  kind: string;
  now: number;
  proposed: number;
}

/** What putting the batch live did, row by row. */
export interface GranularApplyResult {
  saved: { kind: string; name: string; from: number; to: number }[];
  failed: { kind: string; name: string; reason: string }[];
}

/**
 * Put the batch's results live: save each accepted row whose points change,
 * through the same path as a change on Game → Manage (`changeScoringRule`).
 * A row is saved only if it still reads what the admin was shown, so a
 * value someone changed meanwhile is never overwritten unseen. Each row
 * stands alone: a failed row is listed with its reason and the rest still
 * save (engineering rule 6). Points already earned are never touched.
 */
export async function applyGranularPoints(
  store: ScoringRuleStore,
  actor: GameActor,
  accepted: readonly AcceptedProposal[],
  tool: string,
): Promise<GranularApplyResult> {
  const named = requireTool(tool);
  if (!mayManageScoring(actor)) throw new CoreError('Only an admin can put new action points live. Nothing was saved.');
  const rules = await store.rules();
  const current = proposeGranularPoints(rules);
  const result: GranularApplyResult = { saved: [], failed: [] };
  for (const a of accepted) {
    const rule = rules.find((r) => r.kind === a.kind);
    const now = current.find((p) => p.kind === a.kind);
    const name = rule?.name ?? String(a.kind);
    if (!rule || !now) {
      result.failed.push({ kind: a.kind, name, reason: 'There is no such action any more.' });
    } else if (now.proposed === null) {
      result.failed.push({ kind: a.kind, name, reason: 'It is not scored yet, so it was left alone.' });
    } else if (now.now !== a.now || now.proposed !== a.proposed) {
      result.failed.push({ kind: a.kind, name, reason: `It changed since you recalculated (now ${now.now}, formula ${now.proposed}). Recalculate and look again.` });
    } else if (!now.changes) {
      continue;
    } else {
      try {
        const { after } = await changeScoringRule(store, actor, { ...rule, points: now.proposed }, named);
        result.saved.push({ kind: a.kind, name: after.name, from: now.now, to: after.points });
      } catch (err) {
        result.failed.push({ kind: a.kind, name, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}

/**
 * Rescoring past points (Dane, 2026-11-03: "I'd like to have the ability to
 * retroactively readjust during the development phase when you aren't sure
 * how many points anything is worth"). While a DEO's scoring is
 * provisional, an admin may bring every member's past points for an action
 * up (or down) to what the action is worth today.
 *
 * The ledger is never rewritten. A rescore adds correction rows: for each
 * member and action whose credit changes, one row of the same kind whose
 * points are the difference (it may be negative), with the tool `rescore`
 * and the rescore's id. The total stays a plain sum (`totalPoints`).
 *
 * What an action should have credited a member = the times they really did
 * it (rows with no rescore id) × its points today. The difference is that
 * minus everything already credited for it, earlier corrections included,
 * so running a rescore twice in a row changes nothing. The database's
 * `apply_rescore` (supabase/migrations/20261103160000_rescore_past_points.sql)
 * works it out the same way.
 */

/** The tool named on every correction row. */
export const RESCORE_TOOL = 'rescore';

/** One member's ledger for one action, added up: what the rescore reads. */
export interface RescoreTally {
  memberId: string;
  /** Their name if their profile is public, else null. */
  memberName: string | null;
  kind: string;
  /** How many times they did it: rows with no rescore id. */
  actions: number;
  /** Every point credited for it so far, corrections included. */
  credited: number;
}

/** One correction row a rescore would add. */
export interface RescoreCorrection {
  memberId: string;
  kind: string;
  points: number;
}

/** What one rescore saved. `rescoreId` is null when it changed nothing. */
export interface RescoreResult {
  rescoreId: string | null;
  rows: number;
  /** The points it added in all, net (negative when it took more away than it gave). */
  points: number;
}

/** What core needs from storage to rescore. The store works the corrections out itself, the way `rescoreCorrections` does. */
export interface RescoreStore {
  rules(): Promise<ScoringRule[]>;
  /** Is scoring still provisional? Only then may anything be rescored. */
  provisional(): Promise<boolean>;
  /** Every member's ledger, added up per action. */
  tallies(): Promise<RescoreTally[]>;
  /**
   * Add the corrections for these actions in one step, worked out afresh
   * inside it. Returns what was saved (`rows` 0 when nothing needed to
   * change); throws when it failed or its answer could not be read.
   */
  apply(kinds: readonly string[], tool: string): Promise<RescoreResult>;
}

/** One action in the preview, across every member. */
export interface RescoreActionRow {
  kind: string;
  name: string;
  timesDone: number;
  creditedNow: number;
  /** Times done × its points today. */
  wouldBe: number;
  /** The net change across every member. It can be 0 while members still change: one up, another down. */
  difference: number;
  /** How many members' credit for it would change. The action needs rescoring when this is above 0. */
  membersChanging: number;
}

/** One member in the preview. */
export interface RescoreMemberRow {
  memberId: string;
  memberName: string | null;
  /** Their whole points total today. */
  now: number;
  /** What each action would add to it (only the actions that change). */
  changes: Record<string, number>;
}

/** The preview: nothing in it has been saved. */
export interface RescorePreview {
  provisional: boolean;
  actions: RescoreActionRow[];
  members: RescoreMemberRow[];
}

/** The correction rows a rescore of `kinds` would add: one per member and action whose credit changes. */
export function rescoreCorrections(rules: readonly ScoringRule[], tallies: readonly RescoreTally[], kinds?: readonly string[]): RescoreCorrection[] {
  const worth = new Map(rules.map((r) => [r.kind, r.points]));
  return tallies.flatMap((t) => {
    const points = worth.get(t.kind);
    if (points === undefined || (kinds && !kinds.includes(t.kind))) return [];
    const difference = t.actions * points - t.credited;
    return difference === 0 ? [] : [{ memberId: t.memberId, kind: t.kind, points: difference }];
  });
}

/** Work out the preview: every action anyone has done, and every member's total now and what would change. Saves nothing. */
export function proposeRescore(rules: readonly ScoringRule[], tallies: readonly RescoreTally[], provisional: boolean): RescorePreview {
  const corrections = rescoreCorrections(rules, tallies);
  const actions = [...rules]
    .sort((a, b) => a.position - b.position)
    .flatMap((r) => {
      const mine = tallies.filter((t) => t.kind === r.kind);
      if (!mine.length) return [];
      const timesDone = mine.reduce((n, t) => n + t.actions, 0);
      const creditedNow = mine.reduce((n, t) => n + t.credited, 0);
      const wouldBe = timesDone * r.points;
      const membersChanging = corrections.filter((c) => c.kind === r.kind).length;
      return [{ kind: r.kind, name: r.name, timesDone, creditedNow, wouldBe, difference: wouldBe - creditedNow, membersChanging }];
    });
  const members = new Map<string, RescoreMemberRow>();
  for (const t of tallies) {
    const m = members.get(t.memberId) ?? { memberId: t.memberId, memberName: t.memberName, now: 0, changes: {} };
    m.now += t.credited;
    members.set(t.memberId, m);
  }
  for (const c of corrections) {
    const m = members.get(c.memberId);
    if (m) m.changes[c.kind] = c.points;
  }
  return { provisional, actions, members: [...members.values()].sort((a, b) => b.now - a.now) };
}

/** A member's total after rescoring only the ticked actions. */
export function totalAfterRescore(member: RescoreMemberRow, kinds: readonly string[]): number {
  return member.now + kinds.reduce((sum, k) => sum + (member.changes[k] ?? 0), 0);
}

const FINAL_MESSAGE = 'Points are final for this DEO, so past points can no longer be rescored. Nothing was saved.';

/** The preview, for an admin. Refused for anyone else, though it saves nothing. */
export async function previewRescore(store: Pick<RescoreStore, 'rules' | 'provisional' | 'tallies'>, actor: GameActor): Promise<RescorePreview> {
  if (!mayManageScoring(actor)) throw new CoreError('Only an admin can rescore past points.');
  const [rules, tallies, provisional] = await Promise.all([store.rules(), store.tallies(), store.provisional()]);
  return proposeRescore(rules, tallies, provisional);
}

/**
 * Rescore the ticked actions: add their correction rows. Only an admin may,
 * and only while scoring is provisional. Nothing to change saves nothing and
 * says so (`rows` 0). The store works the corrections out afresh in the same
 * step it writes them, so a point earned since the preview is counted too;
 * core does not work them out first, so its answer is the store's own.
 */
export async function applyRescore(store: RescoreStore, actor: GameActor, kinds: unknown, tool: string): Promise<RescoreResult> {
  const named = requireTool(tool);
  if (!mayManageScoring(actor)) throw new CoreError('Only an admin can rescore past points. Nothing was saved.');
  if (!Array.isArray(kinds) || !kinds.length || kinds.some((k) => typeof k !== 'string' || !k)) {
    throw new CoreError('Tick at least one action to rescore. Nothing was saved.');
  }
  if (!(await store.provisional())) throw new CoreError(FINAL_MESSAGE);
  return store.apply(kinds, named);
}
