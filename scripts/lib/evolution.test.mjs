import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubject, ticketUrl, choosePage, fillPage, asOf, entryRow, mountain, listLine } from './evolution.mjs';

// The app's files at three real points in main's history.
const PLACEHOLDER = ['app/favicon.ico', 'app/globals.css', 'app/layout.tsx', 'app/page.tsx'];
const TODO_LIST = [...PLACEHOLDER, 'app/auth/actions.ts', 'app/auth/confirm/route.ts', 'app/lib/supabase.ts', 'app/sign-in/page.tsx', 'app/tasks/TaskList.tsx', 'app/tasks/actions.ts'];
const WITH_HOME = [
  'app/SiteHeader.tsx', 'app/globals.css', 'app/layout.tsx', 'app/page.tsx', 'app/lib/taskStore.ts',
  'app/game/page.tsx', 'app/game/GameMenu.tsx', 'app/game/leaderboard/page.tsx', 'app/game/manage/page.tsx',
  'app/tasks/page.tsx', 'app/tasks/TaskList.tsx', 'app/tasks/[id]/page.tsx', 'app/tasks/[id]/TaskDiscussion.tsx',
  'app/members/page.tsx', 'app/auth/confirm/route.ts',
];

test('parseSubject splits the PR title from its number', () => {
  assert.deepEqual(parseSubject('Dane wants X: do Y (#56)'), { title: 'Dane wants X: do Y', prNumber: 56 });
  assert.deepEqual(parseSubject('WaveCenter: first commit — README and .gitignore'), { title: 'WaveCenter: first commit — README and .gitignore', prNumber: null });
});

test('ticketUrl finds the ClickUp link in a PR body', () => {
  assert.equal(ticketUrl('Summary\n\nhttps://app.clickup.com/t/86bcvtyhh\n\nmore'), 'https://app.clickup.com/t/86bcvtyhh');
  assert.equal(ticketUrl('no link here'), null);
});

test('a file under app/<segment>/ pictures /<segment>', () => {
  assert.equal(choosePage({ changed: ['app/members/MemberTable.tsx'], files: WITH_HOME }), '/members');
});

test('a sub-page pictures itself, and a section with its sub-pages pictures the section', () => {
  assert.equal(choosePage({ changed: ['app/game/leaderboard/page.tsx'], files: WITH_HOME }), '/game/leaderboard');
  // #56: the Game menu plus its two placeholder sub-pages.
  const pr56 = ['app/game/GameMenu.tsx', 'app/game/GamePlaceholder.tsx', 'app/game/leaderboard/page.tsx', 'app/game/manage/page.tsx', 'app/game/page.tsx', 'app/globals.css'];
  assert.equal(choosePage({ changed: pr56, files: [...WITH_HOME, 'app/game/GamePlaceholder.tsx'] }), '/game');
});

test('app/page.tsx pictures /', () => {
  assert.equal(choosePage({ changed: ['app/page.tsx'], files: WITH_HOME }), '/');
  assert.equal(choosePage({ changed: ['app/page.tsx'], files: PLACEHOLDER }), '/');
});

test('shared files only picture the Home page once it exists', () => {
  for (const f of ['app/SiteHeader.tsx', 'app/globals.css', 'app/lib/taskStore.ts', 'app/layout.tsx']) {
    assert.equal(choosePage({ changed: [f], files: WITH_HOME }), '/', f);
  }
});

test('shared files picture /tasks when there is a task page but no Home page', () => {
  const noHome = WITH_HOME.filter((f) => f !== 'app/page.tsx');
  assert.equal(choosePage({ changed: ['app/SiteHeader.tsx'], files: noHome }), '/tasks');
});

test('a folder whose page does not exist yet counts as shared (the list lived at / before #54)', () => {
  assert.equal(choosePage({ changed: ['app/tasks/TaskList.tsx', 'app/tasks/actions.ts'], files: TODO_LIST }), '/');
});

test('a dynamic segment comes back as its pattern, and is filled with a task that existed then', () => {
  const page = choosePage({ changed: ['app/tasks/[id]/TaskDiscussion.tsx'], files: WITH_HOME });
  assert.equal(page, '/tasks/[id]');
  const tasks = [{ id: 'old', created_at: '2026-10-01T00:00:00Z' }, { id: 'new', created_at: '2026-10-02T00:00:00Z' }];
  assert.equal(fillPage(page, tasks), '/tasks/new');
  assert.equal(fillPage(page, []), null);
  assert.equal(fillPage('/game', []), '/game');
});

test('shared files count for the Home page when several pages are touched (#54)', () => {
  const pr54 = ['app/InfoPage.tsx', 'app/Mission.tsx', 'app/SiteHeader.tsx', 'app/about/page.tsx', 'app/deo/page.tsx', 'app/game/page.tsx',
    'app/globals.css', 'app/page.tsx', 'app/tasks/[id]/page.tsx', 'app/tasks/actions.ts', 'app/tasks/page.tsx'];
  assert.equal(choosePage({ changed: pr54, files: [...WITH_HOME, 'app/about/page.tsx', 'app/deo/page.tsx'] }), '/');
});

test('the most-touched page wins', () => {
  assert.equal(choosePage({ changed: ['app/SiteHeader.tsx', 'app/tasks/page.tsx', 'app/tasks/TaskList.tsx', 'app/members/page.tsx'], files: WITH_HOME }), '/tasks');
});

test('no app/ change, or no app yet, is no screen', () => {
  assert.equal(choosePage({ changed: ['docs/WORK-LOG.md', 'scripts/clickup.mjs'], files: WITH_HOME }), null);
  assert.equal(choosePage({ changed: ['README.md'], files: ['README.md', '.gitignore'] }), null);
  assert.equal(choosePage({ changed: ['app/lib/x.ts'], files: ['app/lib/x.ts'] }), null);
});

const T = '2026-10-28T12:00:00Z';
const before = '2026-10-27T00:00:00Z';
const after = '2026-10-29T00:00:00Z';
const LIVE = {
  users: [{ id: 'dane', created_at: before }, { id: 'late', created_at: after }],
  tables: {
    tasks: [
      { id: 't1', owner_id: 'dane', status: 'done', completed_at: before, created_at: before, updated_at: after, parent_task_id: null, priority: 'high' },
      { id: 't2', owner_id: 'dane', status: 'done', completed_at: after, created_at: before, updated_at: after, parent_task_id: 't3', priority: 'low' },
      { id: 't3', owner_id: 'dane', status: 'todo', completed_at: null, created_at: after, updated_at: after, parent_task_id: null, priority: 'low' },
      { id: 't4', owner_id: 'late', status: 'todo', completed_at: null, created_at: before, updated_at: before, parent_task_id: null, priority: 'low' },
    ],
    task_comments: [{ id: 'c1', task_id: 't1', owner_id: 'dane', created_at: before }, { id: 'c2', task_id: 't3', owner_id: 'dane', created_at: before }, { id: 'c3', task_id: 't1', owner_id: 'dane', created_at: after }],
    task_files: [{ id: 'f1', task_id: 't1', owner_id: 'dane', comment_id: 'c1', created_at: before }, { id: 'f2', task_id: 't1', owner_id: 'dane', comment_id: 'c3', created_at: before }],
    engagements: [{ id: 'e1', member_id: 'dane', task_id: 't1', created_at: before }, { id: 'e2', member_id: 'dane', task_id: null, created_at: after }],
    member_profiles: [{ owner_id: 'dane', display_name: 'Dane of Earth' }, { owner_id: 'late', display_name: 'Later' }],
    member_roles: [{ member_id: 'dane', role: 'admin' }],
  },
};
const ALL_COLUMNS = {
  tasks: ['id', 'owner_id', 'status', 'completed_at', 'created_at', 'updated_at', 'parent_task_id', 'priority'],
  task_comments: ['id', 'task_id', 'owner_id', 'created_at'],
  task_files: ['id', 'task_id', 'owner_id', 'comment_id', 'created_at'],
  engagements: ['id', 'member_id', 'task_id', 'created_at'],
  member_profiles: ['owner_id', 'display_name'],
  member_roles: ['member_id', 'role'],
};

test('asOf keeps only members, tasks and rows that existed at the merge', () => {
  const got = asOf(LIVE, { mergedAt: T, columns: ALL_COLUMNS });
  assert.deepEqual(got.users.map((u) => u.id), ['dane']);
  assert.deepEqual(got.tables.tasks.map((r) => r.id), ['t1', 't2'], 't3 was made later; t4 belongs to a later member');
  assert.deepEqual(got.tables.task_comments.map((r) => r.id), ['c1'], 'c2 is on a later task, c3 was written later');
  assert.deepEqual(got.tables.task_files.map((r) => r.id), ['f1'], 'f2 hangs off a later comment');
  assert.deepEqual(got.tables.engagements.map((r) => r.id), ['e1']);
  assert.deepEqual(got.tables.member_profiles.map((r) => r.owner_id), ['dane']);
  assert.deepEqual(got.tables.member_roles.map((r) => r.member_id), ['dane']);
});

test('asOf counts a task done only if it was completed by then', () => {
  const { tables } = asOf(LIVE, { mergedAt: T, columns: ALL_COLUMNS });
  const [t1, t2] = tables.tasks;
  assert.equal(t1.status, 'done');
  assert.equal(t1.completed_at, before);
  assert.equal(t2.status, 'todo');
  assert.equal(t2.completed_at, null);
  assert.equal(t2.parent_task_id, null, 'its parent did not exist yet');
  assert.equal(t1.updated_at, T, 'a later change time is clamped to the merge');
});

test('asOf drops columns and skips tables the old database did not have', () => {
  const { tables } = asOf(LIVE, { mergedAt: T, columns: { tasks: ['id', 'status', 'owner_id'] } });
  assert.deepEqual(Object.keys(tables), ['tasks']);
  assert.deepEqual(tables.tasks[0], { id: 't1', status: 'done', owner_id: 'dane' });
});

test('asOf refuses a time it cannot read', () => {
  assert.throws(() => asOf(LIVE, { mergedAt: 'soon', columns: {} }), /not a time/);
});

const SHA = 'cb2c1f1'.padEnd(40, '0');
const BASE = { sha: SHA, mergedAt: T, prNumber: 56, title: 'Game menu', ticketUrl: null };

test('entryRow never records a captured row without its stored screenshot', () => {
  assert.throws(() => entryRow({ ...BASE, page: '/game', state: 'captured' }), /stored screenshot/);
  assert.equal(entryRow({ ...BASE, page: '/game', screenshotPath: `${SHA}.png`, state: 'captured' }).screenshot_path, `${SHA}.png`);
});

test('entryRow needs a reason for a failure, and keeps no picture for one', () => {
  assert.throws(() => entryRow({ ...BASE, page: '/game', state: 'failed', reason: ' ' }), /reason/);
  const row = entryRow({ ...BASE, page: '/game', screenshotPath: 'x.png', state: 'failed', reason: 'the app did not build' });
  assert.equal(row.screenshot_path, null);
  assert.equal(row.failure_reason, 'the app did not build');
});

test('entryRow refuses a short commit id and an unknown state', () => {
  assert.throws(() => entryRow({ ...BASE, sha: 'cb2c1f1', state: 'no screen' }), /full commit id/);
  assert.throws(() => entryRow({ ...BASE, state: 'skipped' }), /unknown capture state/);
});

test('times are shown in Mountain time', () => {
  assert.equal(mountain('2026-10-30T20:05:00Z'), '2026-10-30 14:05 MDT');
  assert.equal(mountain('2026-12-01T20:05:00Z'), '2026-12-01 13:05 MST');
});

test('listLine prints sha, date, state, page and title', () => {
  const row = entryRow({ ...BASE, page: '/game', screenshotPath: 'x.png', state: 'captured' });
  assert.equal(listLine(row), `cb2c1f1\t2026-10-28 06:00 MDT\tcaptured\t/game\tGame menu`);
  assert.match(listLine(entryRow({ ...BASE, state: 'failed', reason: 'no build' })), /failed \(no build\)\t-\t/);
});
