import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ACCOUNT_FALLBACK_TOOL, newAccountData } from './accounts.ts';
import { handOffTask, setAgentsOn, type MemberSettings, type MemberSettingsStore } from './agents.ts';
import { attachFile, deleteTaskWithFiles, filePath, removeFile } from './files.ts';
import {
  ENGAGEMENT_KINDS, FACTOR_MAX, FACTOR_TESTS, RULE_NAME_MAX, RULE_TEXT_MAX, SCORING_TRIGGERS, STARTING_SCORING_RULES, addScoringRule,
  applyGranularPoints, changeScoringFactors, changeScoringRule, checkFactors, checkRuleFields, engagementKindForTask, granularPoints,
  isWired, kindFromName, mayManageScoring, proposeGranularPoints, recalculateGranularPoints, recordEngagement, scoreEngagement,
  totalPoints, type EngagementInput, type FactorReasons, type GameActor, type ScoringFactors,
} from './game.ts';
import { saveProfile, type MemberProfile, type MemberProfileStore } from './profiles.ts';
import { setPoints } from './points.ts';
import { createTask, deleteTask, updateTask } from './tasks.ts';
import { MemoryAccountStore } from './memoryAccountStore.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';
import { MemoryTaskFileStore } from './memoryTaskFileStore.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';

function setup(member = 'dane') {
  const ledger = new MemoryEngagementStore();
  const tasks = new MemoryTaskStore(member, ledger);
  const files = new MemoryTaskFileStore(member, ledger);
  // Deleting a task drops its file rows, as the real table's cascade does.
  const remove = tasks.remove.bind(tasks);
  tasks.remove = async (id, tool) => {
    const gone = await remove(id, tool);
    if (gone) files.dropRowsFor(id);
    return gone;
  };
  return { ledger, tasks, files };
}

const kinds = (ledger: MemoryEngagementStore) => ledger.rows.map((e) => e.kind);
const SWEEP_SQL = readFileSync(new URL('../supabase/migrations/20261102120000_scoring_actions_sweep.sql', import.meta.url), 'utf8');

test('every kind has a starting rule, and only finishing a task is worth more than 1', () => {
  assert.deepEqual(STARTING_SCORING_RULES.map((r) => r.kind), [...ENGAGEMENT_KINDS]);
  for (const rule of STARTING_SCORING_RULES) assert.equal(rule.points, rule.kind === 'finished_task' ? 5 : 1, rule.kind);
});

test('the migrations seed exactly the starting rules core knows', () => {
  const read = (file: string) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  const row = /^\s*\('([a-z_]+)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*(\d+),\s*(\d+)\)/gm;
  const rowsOf = (sql: string) => [...sql.matchAll(row)].map((m) => ({
    kind: m[1], name: m[2].replaceAll("''", "'"), description: m[3].replaceAll("''", "'"), criteria: m[4].replaceAll("''", "'"),
    points: Number(m[5]), position: Number(m[6]),
  }));
  const seeded = rowsOf(['20261027120000_game_layer.sql', '20261028120000_member_profiles.sql', '20261028140000_task_votes.sql'].map(read).join('\n'));
  // The sweep's rows go after those, in its own order; the ones wired since are starting rules too.
  const last = Math.max(...seeded.map((r) => r.position));
  const swept = sweepRows().filter((r) => isWired(r.kind)).map(({ ord, ...r }) => ({ ...r, position: last + ord }));
  assert.deepEqual([...seeded, ...swept], STARTING_SCORING_RULES);
});

test('making, changing, finishing and deleting a task each record exactly one engagement', async () => {
  const { ledger, tasks } = setup();
  const task = await createTask(tasks, { title: 'Game test' }, 'wavecenter', 'admin');
  assert.deepEqual(kinds(ledger), ['made_task']);
  await updateTask(tasks, task.id, { title: 'Game test, renamed' }, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['made_task', 'changed_task']);
  await updateTask(tasks, task.id, { status: 'done' }, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['made_task', 'changed_task', 'finished_task']);
  await deleteTask(tasks, task.id, 'cleanup-tool');
  assert.deepEqual(kinds(ledger), ['made_task', 'changed_task', 'finished_task', 'deleted_task']);
  assert.deepEqual(ledger.rows.map((e) => e.points), [1, 1, 5, 1]);
  for (const e of ledger.rows) {
    assert.equal(e.memberId, 'dane');
    assert.equal(e.taskId, task.id);
  }
  assert.deepEqual(ledger.rows.map((e) => e.tool), ['wavecenter', 'wavecenter', 'wavecenter', 'cleanup-tool'], 'a delete names the tool that deleted');
});

test('changing a task\'s points is a change like any other', async () => {
  const { ledger, tasks } = setup();
  const task = await createTask(tasks, { title: 'x' }, 'wavecenter', 'admin');
  await setPoints(tasks, task.id, 8, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['made_task', 'changed_task']);
});

test('deleting a parent records one engagement, not one for each sub-task it lets go', async () => {
  const { ledger, tasks } = setup();
  const parent = await createTask(tasks, { title: 'Plan' }, 'wavecenter', 'admin');
  await createTask(tasks, { title: 'Step', parentTaskId: parent.id }, 'wavecenter', 'admin');
  ledger.rows.length = 0;
  await deleteTask(tasks, parent.id, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['deleted_task']);
});

test('attaching and removing a file each record one engagement; deleting the task with its files records one', async () => {
  const { ledger, tasks, files } = setup();
  const task = await createTask(tasks, { title: 'Add the logo' }, 'wavecenter', 'admin');
  const upload = (name: string) => {
    const path = filePath('dane', task.id, `r${files.objects.size + 1}`, name);
    files.objects.add(path);
    return { taskId: task.id, path, name, sizeBytes: 10 };
  };
  const file = await attachFile(tasks, files, upload('logo.png'), 'wavecenter');
  await removeFile(files, file.id, 'wavecenter');
  await attachFile(tasks, files, upload('again.png'), 'wavecenter');
  await deleteTaskWithFiles(tasks, files, task.id, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['made_task', 'attached_file', 'removed_file', 'attached_file', 'deleted_task']);
});

test('handing a task to agents is its own kind, credited to the member, naming the hand-off lane', async () => {
  const { ledger, tasks } = setup();
  const task = await createTask(tasks, { title: 'Build it' }, 'wavecenter', 'admin');
  await updateTask(tasks, task.id, { agentSelected: true }, 'wavecenter');
  await handOffTask(tasks, task.id, 'https://app.clickup.com/t/abc', 'loop-handoff');
  assert.deepEqual(kinds(ledger), ['made_task', 'changed_task', 'handed_to_agents']);
  assert.equal(ledger.rows[2].memberId, 'dane');
  assert.equal(ledger.rows[2].tool, 'loop-handoff');
});

test('flipping the AI agents switch records one engagement each time', async () => {
  const ledger = new MemoryEngagementStore();
  // What the member_settings trigger does: score the save inside it.
  const settings: MemberSettingsStore & { row: MemberSettings | null } = {
    row: null,
    async get() { return this.row; },
    async save(s) {
      await recordEngagement(ledger, { memberId: 'dane', kind: 'switched_agents', tool: s.tool });
      this.row = { ...s };
      return this.row;
    },
  };
  await setAgentsOn(settings, true, 'wavecenter');
  await setAgentsOn(settings, false, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['switched_agents', 'switched_agents']);
});

test('if the engagement cannot be written, the change is not saved either, and says so', async () => {
  const { ledger, tasks, files } = setup();
  const task = await createTask(tasks, { title: 'Keep me' }, 'wavecenter', 'admin');
  ledger.failInsert = true;
  await assert.rejects(createTask(tasks, { title: 'Never saved' }, 'wavecenter', 'admin'), /ledger is down/);
  assert.equal(tasks.rows.size, 1);
  await assert.rejects(updateTask(tasks, task.id, { status: 'done' }, 'wavecenter'), /ledger is down/);
  assert.equal(tasks.rows.get(task.id)?.status, 'todo');
  await assert.rejects(deleteTask(tasks, task.id, 'wavecenter'), /ledger is down/);
  assert.ok(tasks.rows.has(task.id));
  const path = filePath('dane', task.id, 'r1', 'a.png');
  files.objects.add(path);
  await assert.rejects(attachFile(tasks, files, { taskId: task.id, path, name: 'a.png', sizeBytes: 1 }, 'wavecenter'), /ledger is down/);
  assert.equal(files.rows.size, 0);
  assert.equal(files.objects.size, 0, 'the stored copy is cleaned up, as for any failed attach');
});

test('a tool cannot set the points; they come from the rule', async () => {
  const ledger = new MemoryEngagementStore();
  const sneaky = { memberId: 'dane', kind: 'made_task', tool: 'my-tool', points: 1000 } as EngagementInput;
  await assert.rejects(recordEngagement(ledger, sneaky), /cannot set what an engagement is worth/);
  assert.equal(ledger.rows.length, 0);
  ledger.ruleList = ledger.ruleList.map((r) => (r.kind === 'made_task' ? { ...r, points: 3 } : r));
  const e = await recordEngagement(ledger, { memberId: 'dane', kind: 'made_task', tool: 'my-tool' });
  assert.equal(e.points, 3);
});

test('an unknown kind, a kind with no rule, no tool and no member are refused, and nothing is saved', async () => {
  const ledger = new MemoryEngagementStore();
  await assert.rejects(recordEngagement(ledger, { memberId: 'dane', kind: 'won_lottery', tool: 'x' }), /"won_lottery" is not a kind of engagement WaveCenter scores, so nothing was saved/);
  ledger.ruleList = ledger.ruleList.filter((r) => r.kind !== 'removed_file');
  await assert.rejects(recordEngagement(ledger, { memberId: 'dane', kind: 'removed_file', tool: 'x' }), /no scoring rule for "removed_file"/);
  await assert.rejects(recordEngagement(ledger, { memberId: 'dane', kind: 'made_task', tool: '' }), /must name the tool/);
  await assert.rejects(recordEngagement(ledger, { memberId: '', kind: 'made_task', tool: 'x' }), /name the member/);
  assert.equal(ledger.rows.length, 0);
  assert.throws(() => scoreEngagement([], 'made_task'), /no scoring rule/);
});

test('a member\'s ledger holds only their own engagements, newest first, with their total', async () => {
  const ledger = new MemoryEngagementStore();
  const dane = new MemoryTaskStore('dane', ledger);
  const other = new MemoryTaskStore('someone-else', ledger);
  const t = await createTask(dane, { title: 'a' }, 'wavecenter', 'admin');
  await updateTask(dane, t.id, { status: 'done' }, 'wavecenter');
  await createTask(other, { title: 'b' }, 'wavecenter', 'admin');
  const mine = ledger.ledgerFor('dane');
  assert.deepEqual((await mine.latest(10)).map((e) => e.kind), ['finished_task', 'made_task']);
  assert.equal(await mine.total(), 6);
  assert.equal(await ledger.ledgerFor('nobody').total(), 0);
  assert.deepEqual(await ledger.ledgerFor('nobody').latest(10), []);
});

test('engagementKindForTask and totalPoints', () => {
  const open = { status: 'todo' as const, agentTicketUrl: null };
  assert.equal(engagementKindForTask(null, open), 'made_task');
  assert.equal(engagementKindForTask(open, null), 'deleted_task');
  assert.equal(engagementKindForTask(open, { status: 'done', agentTicketUrl: null }), 'finished_task');
  assert.equal(engagementKindForTask({ status: 'done', agentTicketUrl: null }, { status: 'done', agentTicketUrl: null }), 'changed_task');
  assert.equal(engagementKindForTask(open, { status: 'doing', agentTicketUrl: 'https://x' }), 'handed_to_agents');
  assert.equal(totalPoints([{ points: 1 }, { points: 5 }]), 6);
  assert.equal(totalPoints([]), 0);
});

test('saving a profile records one engagement each time', async () => {
  const ledger = new MemoryEngagementStore();
  // What the member_profiles trigger does: score the save inside it.
  const profiles: MemberProfileStore & { row: MemberProfile | null } = {
    row: null,
    async get() { return this.row; },
    async save(p) {
      await recordEngagement(ledger, { memberId: 'dane', kind: 'changed_profile', tool: p.tool });
      this.row = { ...p };
      return this.row;
    },
  };
  const profile = { displayName: 'Dane', avatar: 'sun', bio: null, visibility: 'public' };
  await saveProfile(profiles, profile, 'wavecenter');
  await saveProfile(profiles, { ...profile, bio: 'Builds WaveCenter.' }, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['changed_profile', 'changed_profile']);
});

test('joining WaveCenter records one engagement, credited to the new member, naming the tool', async () => {
  const ledger = new MemoryEngagementStore();
  const accounts = new MemoryAccountStore(ledger);
  const vee = await accounts.create('vee@example.com', newAccountData(' wavecenter '));
  assert.deepEqual(ledger.rows.map((e) => [e.memberId, e.kind, e.points, e.tool, e.taskId]), [[vee, 'joined_wavecenter', 1, 'wavecenter', null]]);

  // An email already registered makes no account and records nothing.
  assert.equal(await accounts.create('vee@example.com', newAccountData('wavecenter')), null);
  assert.equal(ledger.rows.length, 1);

  // An account made without a tool (the service key) still counts, naming Supabase Auth.
  const eddie = await accounts.create('eddie@example.com');
  assert.deepEqual(ledger.rows.slice(1).map((e) => [e.memberId, e.tool]), [[eddie, ACCOUNT_FALLBACK_TOOL]]);
  assert.throws(() => newAccountData(' '), /must name the tool/);

  // If the engagement cannot be written, the account is not made either.
  ledger.failInsert = true;
  await assert.rejects(accounts.create('kai@example.com', newAccountData('wavecenter')), /ledger is down/);
  assert.equal(accounts.accounts.has('kai@example.com'), false);
  assert.equal(ledger.rows.length, 2);
});

test('every kind names the core function that triggers it, its database trigger, and a test that exists', async () => {
  assert.deepEqual(Object.keys(SCORING_TRIGGERS).sort(), [...ENGAGEMENT_KINDS].sort());
  const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'))
    .join('\n');
  for (const kind of ENGAGEMENT_KINDS) {
    const t = SCORING_TRIGGERS[kind];
    for (const part of ['fn', 'file', 'database', 'test', 'testFile'] as const) assert.ok(t?.[part], `${kind} has no ${part}`);
    const module = await import(new URL(`../${t.file}`, import.meta.url).href);
    assert.equal(typeof module[t.fn], 'function', `${kind}: ${t.file} exports no function ${t.fn}`);
    const tests = readFileSync(new URL(`../${t.testFile}`, import.meta.url), 'utf8');
    assert.ok(tests.includes(`test('${t.test}'`), `${kind}: ${t.testFile} has no test "${t.test}"`);
    assert.ok(migrations.includes(`function public.${t.database}()`), `${kind}: no migration makes public.${t.database}`);
    assert.ok(migrations.includes(`'${kind}'`), `${kind}: no migration names it`);
  }
});

const ADMIN: GameActor = { role: 'admin' };
const rule = async (ledger: MemoryEngagementStore, kind: string) => (await ledger.rules()).find((r) => r.kind === kind)!;

test('an admin changes what an action is worth: the next engagement earns it, earlier ones keep theirs', async () => {
  const { ledger, tasks } = setup();
  await createTask(tasks, { title: 'Before' }, 'wavecenter');
  const change = await changeScoringRule(ledger, ADMIN, { kind: 'made_task', name: ' Made a task ', description: 'Added a task.', criteria: 'A new task is saved.', points: 3 }, 'wavecenter');
  assert.equal(change.before.points, 1);
  assert.deepEqual(change.after, { kind: 'made_task', name: 'Made a task', description: 'Added a task.', criteria: 'A new task is saved.', points: 3, position: 1 });
  assert.equal(change.tool, 'wavecenter');
  assert.equal(ledger.ruleTools.get('made_task'), 'wavecenter');
  await createTask(tasks, { title: 'After' }, 'wavecenter');
  assert.deepEqual(ledger.rows.map((e) => [e.kind, e.points]), [['made_task', 1], ['made_task', 3]]);
});

test('changing a scoring rule records one engagement, credited to the admin who changed it', async () => {
  const ledger = new MemoryEngagementStore();
  ledger.signedIn = 'dane';
  const made = await rule(ledger, 'made_task');
  await changeScoringRule(ledger, ADMIN, { ...made, description: 'Added a task to the list.' }, 'rule-tool');
  assert.deepEqual(ledger.rows.map((e) => [e.memberId, e.kind, e.points, e.tool, e.taskId]), [['dane', 'changed_a_scoring_rule', 1, 'rule-tool', null]]);

  // Each field counts; a save that changes nothing does not.
  await changeScoringRule(ledger, ADMIN, { ...made, description: 'Added a task to the list.', points: 2 }, 'wavecenter');
  assert.equal(ledger.rows.length, 2);
  await changeScoringRule(ledger, ADMIN, { ...made, description: 'Added a task to the list.', points: 2 }, 'wavecenter');
  assert.equal(ledger.rows.length, 2);

  // Refused or failed: nothing is recorded, and the failure says so.
  ledger.signedIn = 'vee';
  await assert.rejects(changeScoringRule(ledger, { role: 'contributor' }, { ...made, points: 9 }, 'wavecenter'), /Only an admin/);
  ledger.signedIn = 'dane';
  await assert.rejects(changeScoringRule(ledger, ADMIN, { ...made, points: -1 }, 'wavecenter'), /negative/);
  ledger.failNextRuleSave = true;
  await assert.rejects(changeScoringRule(ledger, ADMIN, { ...made, points: 9 }, 'wavecenter'), /did not save/);
  assert.equal(ledger.rows.length, 2);

  // Adding a new action is not this action.
  await addScoringRule(ledger, ADMIN, { name: 'Wrote a comment', points: 1 }, 'wavecenter');
  assert.equal(ledger.rows.filter((e) => e.kind === 'changed_a_scoring_rule').length, 2);

  // If the engagement cannot be written, the rule does not change either.
  ledger.failInsert = true;
  await assert.rejects(changeScoringRule(ledger, ADMIN, { ...made, points: 9 }, 'wavecenter'), /ledger is down/);
  assert.equal((await rule(ledger, 'made_task')).points, 2);
});

test('only a role with "Manage game scoring" may change or add an action, and nothing is saved otherwise', async () => {
  const ledger = new MemoryEngagementStore();
  const fields = { kind: 'made_task', name: 'Made a task', points: 100 };
  for (const actor of [{ role: 'contributor' }, { role: 'editor' }, { role: null }, { role: 'admin', grants: { admin: ['member.edit'] } }] as GameActor[]) {
    assert.equal(mayManageScoring(actor), false, JSON.stringify(actor));
    await assert.rejects(changeScoringRule(ledger, actor, fields, 'wavecenter'), /Only an admin can manage the game scoring/);
    await assert.rejects(addScoringRule(ledger, actor, { name: 'Wrote a comment', points: 2 }, 'wavecenter'), /Only an admin/);
  }
  assert.deepEqual(await ledger.rules(), STARTING_SCORING_RULES);
  assert.equal(mayManageScoring(ADMIN), true);
  assert.equal(mayManageScoring({ role: 'editor', grants: { editor: ['game.edit'] } }), true, 'follows the grants the database holds');
});

test('points must be a whole number from 0 up, and every action needs a name; anything else saves nothing', async () => {
  const ledger = new MemoryEngagementStore();
  const bad: [object, RegExp][] = [
    [{ points: -1 }, /can't be negative.*Nothing was saved/],
    [{ points: 2.5 }, /whole number.*Nothing was saved/],
    [{ points: '3' }, /whole number/],
    [{ points: null }, /whole number/],
    [{ name: '   ' }, /needs a name/],
    [{ name: 'x'.repeat(RULE_NAME_MAX + 1) }, /at most 80 characters/],
    [{ description: 'x'.repeat(RULE_TEXT_MAX + 1) }, /at most 500 characters/],
    [{ criteria: 7 }, /must be text/],
  ];
  for (const [extra, message] of bad) {
    await assert.rejects(changeScoringRule(ledger, ADMIN, { kind: 'made_task', name: 'Made a task', points: 2, ...extra }, 'wavecenter'), message);
    await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Wrote a comment', points: 2, ...extra }, 'wavecenter'), message);
  }
  await assert.rejects(changeScoringRule(ledger, ADMIN, { kind: 'made_task', name: 'Made a task', points: 2 }, ''), /must name the tool/);
  await assert.rejects(changeScoringRule(ledger, ADMIN, { kind: 'won_lottery', name: 'Won', points: 2 }, 'wavecenter'), /no action "won_lottery"/);
  assert.deepEqual(await ledger.rules(), STARTING_SCORING_RULES);
  assert.deepEqual(checkRuleFields({ name: 'A', points: 0 }), { name: 'A', description: '', criteria: '', points: 0 }, '0 is allowed');
});

test('a rule change or a new action that does not save says so', async () => {
  const ledger = new MemoryEngagementStore();
  ledger.failNextRuleSave = true;
  await assert.rejects(changeScoringRule(ledger, ADMIN, { kind: 'made_task', name: 'Made a task', points: 4 }, 'wavecenter'), /did not save/);
  ledger.failNextRuleSave = true;
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Wrote a comment', points: 4 }, 'wavecenter'), /did not save/);
  assert.equal((await rule(ledger, 'made_task')).points, 1);
});

test('an admin adds a new action: it is listed, inactive, and earns nothing until it is wired', async () => {
  const ledger = new MemoryEngagementStore();
  const added = await addScoringRule(ledger, ADMIN, { name: 'Wrote a comment!', description: 'Commented on a task.', criteria: '', points: 2 }, 'wavecenter');
  assert.deepEqual(added, { kind: 'wrote_a_comment', name: 'Wrote a comment!', description: 'Commented on a task.', criteria: '', points: 2, position: Math.max(...STARTING_SCORING_RULES.map((r) => r.position)) + 1, factors: null });
  assert.equal(isWired(added.kind), false);
  assert.equal(ENGAGEMENT_KINDS.every(isWired), true);
  await assert.rejects(recordEngagement(ledger, { memberId: 'dane', kind: 'wrote_a_comment', tool: 'x' }), /not a kind of engagement WaveCenter scores/);
  assert.equal(ledger.rows.length, 0);
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'wrote a  COMMENT', points: 1 }, 'wavecenter'), /already an action "Wrote a comment!" \(wrote_a_comment\)/);
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Made a task', points: 9 }, 'wavecenter'), /already an action/);
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: '123', points: 1 }, 'wavecenter'), /at least one letter/);
  assert.equal(kindFromName('  Shared a link (to X) '), 'shared_a_link_to_x');
});

function sweepRows() {
  return [...SWEEP_SQL.matchAll(/^\s*\('([a-z_]+)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*(\d+),\s*(\d+)\)/gm)].map((m) => ({
    kind: m[1], name: m[2].replaceAll("''", "'"), description: m[3].replaceAll("''", "'"), criteria: m[4].replaceAll("''", "'"), points: Number(m[5]), ord: Number(m[6]),
  }));
}

test('the sweep lists each new action once, under the kind the Add form would make, worth 1, and only the wired ones are starting rules', () => {
  const rows = sweepRows();
  assert.equal(rows.length, 14);
  assert.equal(new Set(rows.map((r) => r.kind)).size, rows.length, 'no action twice');
  for (const r of rows) {
    assert.equal(r.kind, kindFromName(r.name), r.name);
    assert.equal(r.points, 1, r.kind);
    assert.ok(r.name.length <= RULE_NAME_MAX && r.description.length <= RULE_TEXT_MAX && r.criteria.length <= RULE_TEXT_MAX, r.kind);
    // Wired since the sweep: each has its own ticket (Dane chose B).
    const starting = STARTING_SCORING_RULES.find((s) => s.kind === r.kind || s.name === r.name);
    assert.equal(Boolean(starting), isWired(r.kind), `${r.kind} is a starting rule exactly when it is wired`);
  }
  assert.equal(isWired('posted_a_comment'), true);
  assert.equal(isWired('edited_a_comment'), true);
  assert.equal(isWired('deleted_a_comment'), true);
  assert.equal(isWired('send_a_message_to_another_member'), true);
  assert.equal(isWired('made_a_team'), true);
  assert.equal(isWired('changed_a_team'), true);
  assert.equal(isWired('deleted_a_team'), true);
  assert.equal(isWired('added_a_member_to_a_team'), true);
  assert.equal(isWired('removed_a_member_from_a_team'), true);
  assert.equal(isWired('changed_a_member_s_role'), true);
  assert.equal(isWired('approved_a_proposed_task'), true);
  assert.equal(isWired('joined_wavecenter'), true);
  assert.equal(isWired('changed_a_scoring_rule'), true);
  assert.equal(isWired('added_a_scoring_action'), true);
  assert.match(SWEEP_SQL, /on conflict \(kind\) do nothing;\s*$/);
  assert.doesNotMatch(SWEEP_SQL.replace(/--.*$/gm, ''), /\b(update|delete)\b/i, 'touches no existing row');
});

test('adding a scoring action records one engagement, credited to the admin who added it', async () => {
  const ledger = new MemoryEngagementStore();
  ledger.signedIn = 'dane';
  await addScoringRule(ledger, ADMIN, { name: 'Wrote a comment', points: 3 }, 'rule-tool');
  assert.deepEqual(ledger.rows.map((e) => [e.memberId, e.kind, e.points, e.tool, e.taskId]), [['dane', 'added_a_scoring_action', 1, 'rule-tool', null]]);

  // Refused or failed: nothing is recorded, and the failure says so.
  ledger.signedIn = 'vee';
  await assert.rejects(addScoringRule(ledger, { role: 'contributor' }, { name: 'Shared a link', points: 1 }, 'wavecenter'), /Only an admin/);
  ledger.signedIn = 'dane';
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Wrote a comment', points: 1 }, 'wavecenter'), /already an action/);
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Shared a link', points: -1 }, 'wavecenter'), /negative/);
  ledger.failNextRuleSave = true;
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Shared a link', points: 1 }, 'wavecenter'), /did not save/);
  assert.equal(ledger.rows.length, 1);

  // Changing an action is not this action.
  await changeScoringRule(ledger, ADMIN, { kind: 'made_task', name: 'Made a task', points: 2 }, 'wavecenter');
  assert.equal(ledger.rows.filter((e) => e.kind === 'added_a_scoring_action').length, 1);

  // If the engagement cannot be written, the action is not added either.
  ledger.failInsert = true;
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Shared a link', points: 1 }, 'wavecenter'), /ledger is down/);
  assert.equal((await ledger.rules()).some((r) => r.kind === 'shared_a_link'), false);
});

test('the migration checks the same lengths core does and grants Manage game scoring to admins only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261031140000_game_scoring_admin.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`length\\(name\\) <= ${RULE_NAME_MAX} and length\\(description\\) <= ${RULE_TEXT_MAX} and length\\(criteria\\) <= ${RULE_TEXT_MAX}`));
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]* on public\.game_scoring_rules/i, 'members never write the table directly');
});

// Granular scoring by formula (docs/GRANULAR_SCORING_ALGORITHM.md) and the
// Admin page's batch job that puts it live.

/** Every row of the document's two tables: the action's kind, its factors, today's points and the proposed points. */
function documentRows() {
  const doc = readFileSync(new URL('../docs/GRANULAR_SCORING_ALGORITHM.md', import.meta.url), 'utf8');
  return [...doc.matchAll(/^\| ([^|]+?) \| (\d+) \| (\d) \| (\d) \| (\d)\*? \| (\d) \| \*\*(\d+)\*\* \|/gm)].map((m) => ({
    name: m[1],
    kind: STARTING_SCORING_RULES.find((r) => r.name === m[1])?.kind ?? kindFromName(m[1]),
    now: Number(m[2]),
    factors: { effort: Number(m[3]), value: Number(m[4]), rarity: Number(m[5]), farmRisk: Number(m[6]) } as ScoringFactors,
    proposed: Number(m[7]),
  }));
}

test('the formula gives the Proposed column of every row in the document', () => {
  const rows = documentRows();
  assert.equal(rows.length, 24);
  for (const r of rows) assert.equal(granularPoints(r.factors), r.proposed, r.name);
});

test('the formula: 1 + E + 2V + R, farm risk not counted, never below 1', () => {
  assert.equal(granularPoints({ effort: 0, value: 0, rarity: 0, farmRisk: 0 }), 1, 'all-zero factors still score 1');
  assert.equal(granularPoints({ effort: 3, value: 3, rarity: 1, farmRisk: 3 }), 11, 'Finished a task');
  assert.equal(granularPoints({ effort: 0, value: 0, rarity: 0, farmRisk: 3 }), 1, 'Switched AI agents on or off');
  for (const farmRisk of [0, 1, 2, 3]) assert.equal(granularPoints({ effort: 1, value: 2, rarity: 1, farmRisk }), 7, `farm risk ${farmRisk} has no effect`);
  assert.equal(granularPoints({ effort: 3, value: 3, rarity: 2, farmRisk: 0 }), 12, 'the top of the scale');
  assert.throws(() => granularPoints({ effort: 4, value: 0, rarity: 0, farmRisk: 0 }), /Effort must be a whole number from 0 to 3/);
  assert.throws(() => granularPoints({ effort: 0, value: 0, rarity: 3, farmRisk: 0 }), /Rarity must be a whole number from 0 to 2/);
  assert.throws(() => granularPoints({ effort: 0, value: 1.5, rarity: 0, farmRisk: 0 }), /Value must be a whole number/);
});

test('factors are all four or none; text digits from a form are accepted', () => {
  assert.equal(checkFactors(null), null);
  assert.equal(checkFactors({ effort: '', value: '', rarity: '', farmRisk: '' }), null);
  assert.deepEqual(checkFactors({ effort: '1', value: '2', rarity: '0', farmRisk: '3' }), { effort: 1, value: 2, rarity: 0, farmRisk: 3 });
  assert.throws(() => checkFactors({ effort: 1, value: 2 }), /all four factors or none; rarity and farm risk are missing/);
  assert.throws(() => checkFactors({ effort: -1, value: 0, rarity: 0, farmRisk: 0 }), /Effort/);
});

test('the dropdowns offer one plain test per level, and the migration holds the same ranges', () => {
  for (const [key, max] of Object.entries(FACTOR_MAX)) assert.equal(FACTOR_TESTS[key as keyof ScoringFactors].levels.length, max + 1, key);
  const doc = readFileSync(new URL('../docs/GRANULAR_SCORING_ALGORITHM.md', import.meta.url), 'utf8').replaceAll('**', '');
  for (const t of Object.values(FACTOR_TESTS)) for (const level of t.levels) assert.ok(doc.includes(level), `${t.name}: "${level}" is word for word from the document`);
  const sql = readFileSync(new URL('../supabase/migrations/20261102180000_scoring_factors.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`effort between 0 and ${FACTOR_MAX.effort} and value between 0 and ${FACTOR_MAX.value} and rarity between 0 and ${FACTOR_MAX.rarity} and farm_risk between 0 and ${FACTOR_MAX.farmRisk}`));
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]* on public\.game_scoring_rules/i, 'members never write the table directly');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /set[^;]*\bpoints\s*=/i, 'the migration changes no points');
});

test('the migration fills every action the document scores, with the same factors', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261102180000_scoring_factors.sql', import.meta.url), 'utf8');
  const filled = [...sql.matchAll(/^\s*\('([a-z_]+)',\s*(\d), (\d), (\d), (\d)\)/gm)].map((m) => ({
    kind: m[1], factors: { effort: Number(m[2]), value: Number(m[3]), rarity: Number(m[4]), farmRisk: Number(m[5]) },
  }));
  assert.deepEqual(filled, documentRows().map((r) => ({ kind: r.kind, factors: r.factors })));
});

/** The document's "Why each factor got its score" table: per action, each factor's score and the reason for it. */
function documentReasons() {
  const doc = readFileSync(new URL('../docs/GRANULAR_SCORING_ALGORITHM.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('### Why each factor got its score'), doc.indexOf('## Scoring an action added later'));
  const keyOf = Object.fromEntries(Object.entries(FACTOR_TESTS).map(([k, t]) => [t.name, k as keyof ScoringFactors]));
  const byKind = new Map<string, { factors: Partial<ScoringFactors>; reasons: Partial<FactorReasons> }>();
  for (const m of section.matchAll(/^\| ([^|]+?) \| (Effort|Value|Rarity|Farm risk) \| (\d) \| ([^|]+?) \|$/gm)) {
    const kind = STARTING_SCORING_RULES.find((r) => r.name === m[1])?.kind ?? kindFromName(m[1]);
    const row = byKind.get(kind) ?? { factors: {}, reasons: {} };
    row.factors[keyOf[m[2]]] = Number(m[3]);
    row.reasons[keyOf[m[2]]] = m[4];
    byKind.set(kind, row);
  }
  return byKind;
}

test('every action the document scores has one reason per factor, given against the same score', () => {
  const reasons = documentReasons();
  const rows = documentRows();
  assert.deepEqual([...reasons.keys()], rows.map((r) => r.kind));
  for (const r of rows) {
    assert.deepEqual(reasons.get(r.kind)?.factors, r.factors, `${r.name}: the reasons table gives the same scores`);
    for (const k of Object.keys(FACTOR_TESTS)) assert.ok(reasons.get(r.kind)?.reasons[k as keyof ScoringFactors], `${r.name}: ${k} has a reason`);
  }
});

test('the reasons migration stores the document\'s 96 reasons word for word, and changes nothing else', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261103120000_scoring_factor_reasons.sql', import.meta.url), 'utf8');
  const quoted = String.raw`'((?:[^']|'')*)'`;
  const filled = [...sql.matchAll(new RegExp(String.raw`^\s*\('([a-z_]+)',\s*${quoted},\s*${quoted},\s*${quoted},\s*${quoted}\)`, 'gm'))].map((m) => [
    m[1], m.slice(2, 6).map((t) => t.replaceAll("''", "'")),
  ]);
  const reasons = documentReasons();
  assert.deepEqual(filled, [...reasons].map(([kind, r]) => [kind, (['effort', 'value', 'rarity', 'farmRisk'] as const).map((k) => r.reasons[k])]));
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /set[^;]*\b(points|effort|value|rarity|farm_risk)\s*=/i, 'the migration changes no points and no factor');
  assert.doesNotMatch(code, /grant (insert|update|delete|all)[^;]*on public\.game_scoring_rules/i, 'members never write the table directly');
});

function scoredLedger() {
  const ledger = new MemoryEngagementStore();
  const rows = documentRows();
  const reasons = documentReasons();
  ledger.ruleList = ledger.ruleList.map((r) => ({
    ...r,
    factors: rows.find((d) => d.kind === r.kind)?.factors ?? null,
    reasons: (reasons.get(r.kind)?.reasons as FactorReasons | undefined) ?? null,
  }));
  return ledger;
}

test('the batch shows now and proposed for every action and saves nothing', async () => {
  const ledger = scoredLedger();
  ledger.ruleList.push({ kind: 'shared_a_link', name: 'Shared a link', description: '', criteria: '', points: 1, position: 11, factors: null });
  const before = await ledger.rules();
  const proposals = await recalculateGranularPoints(ledger, ADMIN);
  assert.deepEqual(await ledger.rules(), before, 'nothing saved');
  assert.deepEqual(proposals.find((p) => p.kind === 'finished_task'), {
    kind: 'finished_task', name: 'Finished a task', factors: { effort: 3, value: 3, rarity: 1, farmRisk: 3 },
    reasons: documentReasons().get('finished_task')?.reasons, now: 5, proposed: 11, changes: true,
  });
  assert.deepEqual(proposals.find((p) => p.kind === 'switched_agents')?.changes, false, '1 stays 1');
  const unscored = proposals.find((p) => p.kind === 'shared_a_link');
  assert.deepEqual([unscored?.proposed, unscored?.changes], [null, false], 'not scored yet, never 0 by accident');
  await assert.rejects(recalculateGranularPoints(ledger, { role: 'viewer' }), /Only an admin can recalculate/);
});

test('the batch passes each action\'s factor reasons through unchanged; a reason not written yet is null', async () => {
  const ledger = scoredLedger();
  ledger.ruleList.push({ kind: 'shared_a_link', name: 'Shared a link', description: '', criteria: '', points: 1, position: 25, factors: null });
  ledger.ruleList.push({
    kind: 'read_a_task', name: 'Read a task', description: '', criteria: '', points: 1, position: 26,
    factors: { effort: 0, value: 0, rarity: 0, farmRisk: 3 }, reasons: { effort: 'One click.', value: null, rarity: null, farmRisk: null },
  });
  const rules = await ledger.rules();
  const proposals = await recalculateGranularPoints(ledger, ADMIN);
  for (const r of rules.filter((x) => x.reasons)) assert.deepEqual(proposals.find((p) => p.kind === r.kind)?.reasons, r.reasons, r.name);
  assert.equal(proposals.find((p) => p.kind === 'made_task')?.reasons.farmRisk, 'Paired with deleting it, so make-and-delete loops.');
  assert.deepEqual(proposals.find((p) => p.kind === 'shared_a_link')?.reasons, { effort: null, value: null, rarity: null, farmRisk: null });
  assert.deepEqual(proposals.find((p) => p.kind === 'read_a_task')?.reasons, { effort: 'One click.', value: null, rarity: null, farmRisk: null });
});

test('putting the batch live saves only the rows that change, and only for an admin', async () => {
  const ledger = scoredLedger();
  const accepted = proposeGranularPoints(await ledger.rules()).flatMap((p) => (p.proposed === null ? [] : [{ kind: p.kind, now: p.now, proposed: p.proposed }]));
  await assert.rejects(applyGranularPoints(ledger, { role: 'viewer' }, accepted, 'wavecenter'), /Only an admin can put new action points live/);
  assert.equal(ledger.ruleTools.size, 0, 'a refused run saves nothing');

  const result = await applyGranularPoints(ledger, ADMIN, accepted, 'wavecenter');
  assert.deepEqual(result.failed, []);
  const changing = documentRows().filter((r) => isWired(r.kind) && r.now !== r.proposed);
  assert.deepEqual(result.saved.map((s) => s.kind), changing.map((r) => r.kind));
  assert.deepEqual([...ledger.ruleTools.keys()], changing.map((r) => r.kind), 'unchanged rows are not written');
  assert.equal((await ledger.rules()).find((r) => r.kind === 'finished_task')?.points, 11);
});

test('a row that fails or changed meanwhile is named with its reason, and the others still save', async () => {
  const ledger = scoredLedger();
  const accepted = [
    { kind: 'made_task', now: 1, proposed: 6 },
    { kind: 'finished_task', now: 5, proposed: 11 },
    { kind: 'deleted_task', now: 1, proposed: 3 },
  ];
  ledger.ruleList = ledger.ruleList.map((r) => (r.kind === 'finished_task' ? { ...r, points: 6 } : r));
  ledger.failNextRuleSave = true;
  const result = await applyGranularPoints(ledger, ADMIN, accepted, 'wavecenter');
  assert.deepEqual(result.failed.map((f) => [f.kind, f.reason.split('.')[0]]), [
    ['made_task', 'The change did not save'],
    ['finished_task', 'It changed since you recalculated (now 6, formula 11)'],
  ]);
  assert.deepEqual(result.saved, [{ kind: 'deleted_task', name: 'Deleted a task', from: 1, to: 3 }]);
});

test('an admin scores an action by hand on Game > Manage, when adding it or later', async () => {
  const ledger = new MemoryEngagementStore();
  const added = await addScoringRule(ledger, ADMIN, { name: 'Shared a link', points: 1, factors: { effort: '1', value: '2', rarity: '0', farmRisk: '2' } }, 'wavecenter');
  assert.deepEqual(added.factors, { effort: 1, value: 2, rarity: 0, farmRisk: 2 });
  const plain = await addScoringRule(ledger, ADMIN, { name: 'Read a task', points: 1 }, 'wavecenter');
  assert.equal(plain.factors, null);
  const scored = await changeScoringFactors(ledger, ADMIN, { kind: 'read_a_task', factors: { effort: 0, value: 0, rarity: 0, farmRisk: 3 } }, 'wavecenter');
  assert.deepEqual(scored.factors, { effort: 0, value: 0, rarity: 0, farmRisk: 3 });
  assert.equal(scored.points, 1, 'the factors change no points until the batch is put live');
  await assert.rejects(changeScoringFactors(ledger, { role: 'viewer' }, { kind: 'read_a_task', factors: null }, 'wavecenter'), /Only an admin/);
  await assert.rejects(changeScoringFactors(ledger, ADMIN, { kind: 'read_a_task', factors: { effort: 9, value: 0, rarity: 0, farmRisk: 0 } }, 'wavecenter'), /Effort/);
  ledger.failNextRuleSave = true;
  await assert.rejects(changeScoringFactors(ledger, ADMIN, { kind: 'read_a_task', factors: null }, 'wavecenter'), /did not save/);
});
