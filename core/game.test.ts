import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { handOffTask, setAgentsOn, type MemberSettings, type MemberSettingsStore } from './agents.ts';
import { attachFile, deleteTaskWithFiles, filePath, removeFile } from './files.ts';
import {
  ENGAGEMENT_KINDS, RULE_NAME_MAX, RULE_TEXT_MAX, SCORING_TRIGGERS, STARTING_SCORING_RULES, addScoringRule, changeScoringRule,
  checkRuleFields, engagementKindForTask, isWired, kindFromName, mayManageScoring, recordEngagement, scoreEngagement, totalPoints,
  type EngagementInput, type GameActor,
} from './game.ts';
import { saveProfile, type MemberProfile, type MemberProfileStore } from './profiles.ts';
import { setPoints } from './points.ts';
import { createTask, deleteTask, updateTask } from './tasks.ts';
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

test('every kind has a starting rule, and only finishing a task is worth more than 1', () => {
  assert.deepEqual(STARTING_SCORING_RULES.map((r) => r.kind), [...ENGAGEMENT_KINDS]);
  for (const rule of STARTING_SCORING_RULES) assert.equal(rule.points, rule.kind === 'finished_task' ? 5 : 1, rule.kind);
});

test('the migrations seed exactly the starting rules core knows', () => {
  const sql = ['20261027120000_game_layer.sql', '20261028120000_member_profiles.sql', '20261028140000_task_votes.sql']
    .map((file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
    .join('\n');
  const seeded = [...sql.matchAll(/^\s*\('([a-z_]+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),\s*(\d+)\)/gm)].map((m) => ({
    kind: m[1], name: m[2], description: m[3], criteria: m[4], points: Number(m[5]), position: Number(m[6]),
  }));
  assert.deepEqual(seeded, STARTING_SCORING_RULES);
});

test('making, changing, finishing and deleting a task each record exactly one engagement', async () => {
  const { ledger, tasks } = setup();
  const task = await createTask(tasks, { title: 'Game test' }, 'wavecenter');
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
  const task = await createTask(tasks, { title: 'x' }, 'wavecenter');
  await setPoints(tasks, task.id, 8, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['made_task', 'changed_task']);
});

test('deleting a parent records one engagement, not one for each sub-task it lets go', async () => {
  const { ledger, tasks } = setup();
  const parent = await createTask(tasks, { title: 'Plan' }, 'wavecenter');
  await createTask(tasks, { title: 'Step', parentTaskId: parent.id }, 'wavecenter');
  ledger.rows.length = 0;
  await deleteTask(tasks, parent.id, 'wavecenter');
  assert.deepEqual(kinds(ledger), ['deleted_task']);
});

test('attaching and removing a file each record one engagement; deleting the task with its files records one', async () => {
  const { ledger, tasks, files } = setup();
  const task = await createTask(tasks, { title: 'Add the logo' }, 'wavecenter');
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
  const task = await createTask(tasks, { title: 'Build it' }, 'wavecenter');
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
  const task = await createTask(tasks, { title: 'Keep me' }, 'wavecenter');
  ledger.failInsert = true;
  await assert.rejects(createTask(tasks, { title: 'Never saved' }, 'wavecenter'), /ledger is down/);
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
  const t = await createTask(dane, { title: 'a' }, 'wavecenter');
  await updateTask(dane, t.id, { status: 'done' }, 'wavecenter');
  await createTask(other, { title: 'b' }, 'wavecenter');
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
  assert.deepEqual(added, { kind: 'wrote_a_comment', name: 'Wrote a comment!', description: 'Commented on a task.', criteria: '', points: 2, position: 11 });
  assert.equal(isWired(added.kind), false);
  assert.equal(ENGAGEMENT_KINDS.every(isWired), true);
  await assert.rejects(recordEngagement(ledger, { memberId: 'dane', kind: 'wrote_a_comment', tool: 'x' }), /not a kind of engagement WaveCenter scores/);
  assert.equal(ledger.rows.length, 0);
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'wrote a  COMMENT', points: 1 }, 'wavecenter'), /already an action "Wrote a comment!" \(wrote_a_comment\)/);
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: 'Made a task', points: 9 }, 'wavecenter'), /already an action/);
  await assert.rejects(addScoringRule(ledger, ADMIN, { name: '123', points: 1 }, 'wavecenter'), /at least one letter/);
  assert.equal(kindFromName('  Shared a link (to X) '), 'shared_a_link_to_x');
});

test('the migration checks the same lengths core does and grants Manage game scoring to admins only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261031140000_game_scoring_admin.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`length\\(name\\) <= ${RULE_NAME_MAX} and length\\(description\\) <= ${RULE_TEXT_MAX} and length\\(criteria\\) <= ${RULE_TEXT_MAX}`));
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]* on public\.game_scoring_rules/i, 'members never write the table directly');
});
