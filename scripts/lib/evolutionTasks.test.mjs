import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BACKFILL_TOOL } from './evolution.mjs';
import { taskIdFromThread, backfillPlan, taskFromCard, planLine, summaryLine, REPO_URL } from './evolutionTasks.mjs';

const TASK = '0b6f6a52-6a0e-4c47-9a54-0e3b1c1f2d3e';
const GONE = '11111111-2222-4333-8444-555555555555';

const card = (over) => ({
  commit_sha: 'a'.repeat(40), merged_at: '2026-10-11T16:55:48+00:00', pr_number: 1,
  title: 'Add founding documents', ticket_url: null, thread_url: null, prompt: null, task_id: null, ...over,
});

test('taskIdFromThread reads only a WaveCenter task link', () => {
  assert.equal(taskIdFromThread(`/tasks/${TASK}`), TASK);
  assert.equal(taskIdFromThread(`/tasks/${TASK.toUpperCase()}/`), TASK);
  assert.equal(taskIdFromThread('https://app.clickup.com/t/86bcgh5wc'), null);
  assert.equal(taskIdFromThread(null), null);
  assert.equal(taskIdFromThread(`/tasks/${TASK}/extra`), null);
});

test('a card from a task that still exists is linked, never given a second task', () => {
  const plan = backfillPlan([card({ thread_url: `/tasks/${TASK}` })], [TASK]);
  assert.equal(plan.link.length, 1);
  assert.equal(plan.link[0].taskId, TASK);
  assert.equal(plan.create.length, 0);
});

test('a chat request, a founding commit, or a deleted task gets a new task', () => {
  const plan = backfillPlan([
    card({ commit_sha: 'b'.repeat(40), thread_url: 'https://app.clickup.com/t/86bcgh5wc', prompt: 'his words' }),
    card({ commit_sha: 'c'.repeat(40), pr_number: null }),
    card({ commit_sha: 'd'.repeat(40), thread_url: `/tasks/${GONE}` }),
  ], [TASK]);
  assert.equal(plan.link.length, 0);
  assert.deepEqual(plan.create.map((c) => c.commit_sha[0]), ['b', 'c', 'd']);
});

test('a card that already has a task is skipped, so a second run does nothing', () => {
  const plan = backfillPlan([card({ task_id: TASK, thread_url: `/tasks/${TASK}` }), card({ task_id: GONE })], [TASK]);
  assert.deepEqual({ link: plan.link.length, create: plan.create.length, already: plan.already }, { link: 0, create: 0, already: 2 });
  assert.equal(summaryLine({ linked: 0, created: 0, already: 2 }), 'Nothing to do: all 2 Evolution cards already have a task.');
  assert.equal(summaryLine({ linked: 0, created: 0, already: 0 }), 'Nothing to do: there are no Evolution cards yet.');
});

test('the plan runs oldest first', () => {
  const plan = backfillPlan([
    card({ commit_sha: 'e'.repeat(40), merged_at: '2026-10-20T00:00:00+00:00' }),
    card({ commit_sha: 'f'.repeat(40), merged_at: '2026-10-04T03:51:19+00:00' }),
  ], []);
  assert.deepEqual(plan.create.map((c) => c.commit_sha[0]), ['f', 'e']);
});

test('the new task carries the title, Dane\'s words, the PR, the ticket and the afterwards line', () => {
  const t = taskFromCard(card({ pr_number: 12, ticket_url: 'https://app.clickup.com/t/86bcgh5wc', prompt: '  make it a list  ' }), { today: '2026-11-02' });
  assert.equal(t.title, 'Add founding documents');
  assert.equal(t.at, '2026-10-11T16:55:48+00:00');
  const [words, where, afterwards] = t.notes.split('\n\n');
  assert.equal(words, 'make it a list');
  assert.equal(where, `Pull request #12: ${REPO_URL}/pull/12\nTicket: https://app.clickup.com/t/86bcgh5wc`);
  assert.match(afterwards, /^This task was created afterwards, on 2026-11-02, so this change's Evolution card has a task\./);
});

test('a card with no words, PR or ticket still says why its task exists', () => {
  const t = taskFromCard(card({ pr_number: null }), { today: '2026-11-02' });
  assert.match(t.notes, /^This task was created afterwards/);
  assert.doesNotMatch(t.notes, /Pull request|Ticket:/);
});

test('plan lines and the summary read plainly, dated in Mountain time', () => {
  // 03:51 UTC on the 4th is the evening of the 3rd in Denver.
  assert.equal(planLine(card({ merged_at: '2026-10-04T03:51:19+00:00', pr_number: null, title: 'First commit' }), 'create'), 'create  2026-10-03  no PR   First commit');
  assert.equal(summaryLine({ linked: 2, created: 3, already: 1 }, { dryRun: true }),
    'Would link 2 card(s) to the task they came from, would create 3 task(s); 1 card(s) already had one. Dry run: nothing was written.');
});

test('the migration makes the backfill score nothing and only the service key may call it', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261102140000_evolution_task_link.sql', import.meta.url), 'utf8');
  assert.match(sql, /current_setting\('wavecenter\.backfill', true\)/);
  assert.match(sql, /set_config\('wavecenter\.backfill', 'on', true\)/);
  assert.ok(sql.includes(`'done', 0, p_at, false, '${BACKFILL_TOOL}'`), 'the tool the pictures leave out is the one the backfill writes');
  assert.match(sql, /revoke execute on function public\.evolution_backfill_task\([^)]*\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.evolution_backfill_task\([^)]*\) to service_role;/);
});
