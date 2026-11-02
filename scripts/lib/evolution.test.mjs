import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, validateCard, costlyTriggers } from './operatorCard.mjs';
import { nameProblem } from './ticketName.mjs';
import { parseSubject, ticketUrl, choosePage, samePage, previousCard, fillPage, asOf, entryRow, mountain, listLine, missingShas, ticketId, laneCapturedOnMerge, failureComment, danesWords, ALERT_AFTER, reasonKey, fixCommand, nextRunState, runAlertCard, runAlertDescription, recoveredNote, RUN_ALERT_NAME, RULES_FILE, recaptureDue, nextRecaptureState, recaptureFailedComment, recaptureDoneNote, RECAPTURE_CUTOFF_LIMIT, noTaskLine, BACKFILL_TOOL } from './evolution.mjs';
import { readFileSync } from 'node:fs';

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

test('#54, which added the Home dashboard and named it, pictures Home over the pages it also added', () => {
  const pr54 = ['app/InfoPage.tsx', 'app/Mission.tsx', 'app/SiteHeader.tsx', 'app/about/page.tsx', 'app/deo/page.tsx', 'app/game/page.tsx',
    'app/globals.css', 'app/page.tsx', 'app/tasks/[id]/page.tsx', 'app/tasks/actions.ts', 'app/tasks/page.tsx'];
  const added = ['app/InfoPage.tsx', 'app/Mission.tsx', 'app/about/page.tsx', 'app/deo/page.tsx', 'app/tasks/page.tsx'];
  const title = 'Dane lands on the task list with no overview: add a Home dashboard page and a Home menu item';
  assert.equal(choosePage({ changed: pr54, added, title, files: [...WITH_HOME, 'app/about/page.tsx', 'app/deo/page.tsx'] }), '/');
});

test('shared files no longer outvote the page the change was about (#29, the game page)', () => {
  assert.equal(choosePage({
    changed: ['app/game/page.tsx', 'app/lib/taskStore.ts'],
    files: WITH_HOME,
    title: 'Members cannot see the points they have earned: add a game page with their score',
  }), '/game');
  // Even with no words at all, the page folder beats the shared files.
  assert.equal(choosePage({ changed: ['app/game/page.tsx', 'app/lib/taskStore.ts', 'app/globals.css'], files: WITH_HOME }), '/game');
});

test('a page the change added wins (#30, the profile page)', () => {
  const files = [...WITH_HOME, 'app/profile/page.tsx', 'app/profile/ProfileForm.tsx', 'app/profile/actions.ts', 'app/lib/memberProfileStore.ts'];
  const changed = ['app/SiteHeader.tsx', 'app/globals.css', 'app/lib/memberProfileStore.ts', 'app/profile/ProfileForm.tsx', 'app/profile/actions.ts', 'app/profile/page.tsx'];
  const added = ['app/lib/memberProfileStore.ts', 'app/profile/ProfileForm.tsx', 'app/profile/actions.ts', 'app/profile/page.tsx'];
  const title = 'Members have no profile page: add one where they set their name, avatar and privacy, anonymous by default';
  assert.equal(choosePage({ changed, added, files, title }), '/profile');
  // An added page beats a page with more changed files.
  assert.equal(choosePage({ changed: ['app/tasks/page.tsx', 'app/tasks/TaskList.tsx', 'app/profile/page.tsx'], added: ['app/profile/page.tsx'], files }), '/profile');
});

test('a change to Home\'s background pictures Home', () => {
  // #83: the page itself plus the header and the stylesheet.
  assert.equal(choosePage({
    changed: ['app/SiteHeader.tsx', 'app/globals.css', 'app/page.tsx'], files: WITH_HOME,
    title: 'Dane wants Home to sit on his water-drop picture: put the drop background behind the whole Home page with see-through, shadowed boxes',
  }), '/');
  // #86: only shared files, and the title names Home.
  assert.equal(choosePage({
    changed: ['app/SiteHeader.tsx', 'app/globals.css'], files: WITH_HOME,
    title: 'Home shows the header as a separate picture from the page: blend the header into the one background and make the boxes 30% see-through',
  }), '/');
});

test('the title names the screen among the pages a change touched', () => {
  // #88 touched Home and the Evolution scroller under app/tasks/, and names both: the shorter address wins.
  assert.equal(choosePage({
    changed: ['app/globals.css', 'app/page.tsx', 'app/tasks/Evolution.tsx'], files: WITH_HOME,
    title: 'Dane wants a tidier Home: four equal pods in the top row, Evolution of WaveCenter with arrow buttons, and working and recently completed tasks side by side below it',
  }), '/');
  // A named page beats one with more changed files.
  assert.equal(choosePage({
    changed: ['app/tasks/page.tsx', 'app/tasks/TaskList.tsx', 'app/members/page.tsx'], files: WITH_HOME,
    title: 'Dane cannot find a member: add a search box to the members list',
  }), '/members');
  // Words only name pages that exist at that change, and only whole words.
  assert.equal(choosePage({ changed: ['app/tasks/TaskList.tsx'], files: TODO_LIST, title: 'Dane wants his tasks sorted: sort them' }), '/');
  assert.equal(choosePage({ changed: ['app/tasks/page.tsx', 'app/game/page.tsx', 'app/game/GameMenu.tsx'], files: WITH_HOME, title: 'Endgame: tidy the menus' }), '/game');
});

test('a change of only shared files pictures the page its fix names, else Home', () => {
  assert.equal(choosePage({ changed: ['app/lib/taskStore.ts'], files: WITH_HOME, title: 'Points vanish: show them on the game page' }), '/game');
  // Who feels it ("Members cannot...") does not name the screen; the fix does.
  assert.equal(choosePage({ changed: ['app/lib/taskStore.ts'], files: WITH_HOME, title: 'Members cannot save: retry the write' }), '/');
  // Dane's words decide when the title names nothing.
  assert.equal(choosePage({ changed: ['app/globals.css'], files: WITH_HOME, title: 'Fix the colours', prompt: 'The members page is too dark' }), '/members');
});

test('the same page is pictured again when it is the change\'s focus', () => {
  // Dane, 2026-11-01: "the image itself should be unique, not the page".
  // A Home change after a Home card is still Home, even when it also
  // touched another page (#88 after #86).
  const changed = ['app/page.tsx', 'app/tasks/Evolution.tsx'];
  assert.equal(choosePage({ changed, files: WITH_HOME, title: 'Dane wants a tidier Home: four equal pods' }), '/');
  assert.equal(choosePage({ changed: ['app/page.tsx'], files: WITH_HOME }), '/');
  assert.equal(choosePage({ changed: ['app/SiteHeader.tsx'], files: WITH_HOME }), '/');
  // The page the change touched most wins, whatever the card before showed.
  assert.equal(choosePage({ changed: ['app/tasks/[id]/TaskDiscussion.tsx', 'app/tasks/[id]/page.tsx', 'app/members/page.tsx'], files: WITH_HOME }), '/tasks/[id]');
});

test('samePage matches a stored page against its pattern', () => {
  assert.equal(samePage('/tasks/[id]', '/tasks/3f2a'), true);
  assert.equal(samePage('/tasks/[id]', '/tasks'), false);
  assert.equal(samePage('/', '/'), true);
  assert.equal(samePage('/game', '/game/leaderboard'), false);
  assert.equal(samePage(null, null), true);
});

test('previousCard is the newest captured card merged before the change', () => {
  const rows = [
    { commit_sha: 'a', merged_at: '2026-10-01T00:00:00Z', capture_state: 'captured', page: '/' },
    { commit_sha: 'b', merged_at: '2026-10-02T00:00:00Z', capture_state: 'captured', page: '/game' },
    { commit_sha: 'c', merged_at: '2026-10-03T00:00:00Z', capture_state: 'no screen', page: null },
    { commit_sha: 'd', merged_at: '2026-10-05T00:00:00Z', capture_state: 'captured', page: '/members' },
  ];
  assert.equal(previousCard(rows, '2026-10-04T00:00:00Z').commit_sha, 'b');
  assert.equal(previousCard(rows, '2026-10-02T00:00:00Z').commit_sha, 'a');
  assert.equal(previousCard(rows, '2026-10-01T00:00:00Z'), null);
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

test('asOf leaves out a task the Evolution backfill made afterwards, though it is dated earlier', () => {
  const live = { ...LIVE, tables: { ...LIVE.tables, tasks: [...LIVE.tables.tasks, { id: 't5', owner_id: 'dane', status: 'done', completed_at: before, created_at: before, updated_at: after, parent_task_id: null, priority: 'normal', tool: BACKFILL_TOOL }] } };
  const { tables } = asOf(live, { mergedAt: T, columns: ALL_COLUMNS });
  assert.deepEqual(tables.tasks.map((r) => r.id), ['t1', 't2']);
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

test('entryRow carries Dane\'s words and their thread, and no thread without words', () => {
  const row = entryRow({ ...BASE, state: 'no screen', prompt: 'Use real data.', threadUrl: 'https://app.clickup.com/t/86x' });
  assert.equal(row.prompt, 'Use real data.');
  assert.equal(row.thread_url, 'https://app.clickup.com/t/86x');
  const bare = entryRow({ ...BASE, state: 'no screen', threadUrl: 'https://app.clickup.com/t/86x' });
  assert.equal(bare.prompt, null);
  assert.equal(bare.thread_url, null);
});

const TASK = 'a1611610-e4d7-4b13-ac2f-bf909f57db1d';
const FROM_WC = `## From WaveCenter

\`\`\`css
The header background overlay is too dark

It appears there is a dark overlay on the header.
\`\`\`

WaveCenter task: ${TASK}

## Goal
Yes, there is a dark overlay.`;
const CARD = (asked, when = '') => `DANE'S WORDS — the instruction behind this ticket\n\n${asked}\n\n${when ? `(${when})\n\n` : ''}WHAT'S GOING ON\n\nThe context.\n\n#############################\nNEEDED FROM DANE: merge\n\n[machine] posted by a loop`;

test('a WaveCenter ticket gives the task\'s title and notes, verbatim, linking to the task', () => {
  const words = danesWords({ url: 'https://app.clickup.com/t/86bcw3my3', tags: ['from-wavecenter'], description: FROM_WC, comments: [{ text: CARD('Something else') }] });
  assert.equal(words.prompt, 'The header background overlay is too dark\n\nIt appears there is a dark overlay on the header.');
  assert.equal(words.threadUrl, `/tasks/${TASK}`);
  assert.equal(words.taskId, TASK);
});

test('the WaveCenter task a ticket names is its card\'s task link, whatever the words, and goes on the row', () => {
  const card = danesWords({ url: 'u', tags: [], description: `## Goal\nx\n\nWaveCenter task: ${TASK}\n`, comments: [{ text: CARD('Asked.') }] });
  assert.deepEqual(card, { prompt: 'Asked.', threadUrl: 'u', taskId: TASK });
  assert.deepEqual(danesWords({ url: 'u', tags: [], description: `WaveCenter task: ${TASK}`, comments: [] }), { prompt: null, threadUrl: null, taskId: TASK });
  assert.equal(entryRow({ ...BASE, state: 'no screen', taskId: TASK }).task_id, TASK);
  assert.equal(entryRow({ ...BASE, state: 'no screen' }).task_id, null);
  // A malformed id (right length, wrong shape) is no link, not a failed run.
  assert.equal(danesWords({ url: 'u', tags: [], description: `WaveCenter task: ${'-'.repeat(36)}`, comments: [] }).taskId, null);
});

test('any other ticket gives the first card\'s asked words, without its when line, linking to the ticket', () => {
  const words = danesWords({
    url: 'https://app.clickup.com/t/86bcvtyhk',
    tags: ['evolution'],
    description: '## Goal\nx',
    comments: [{ text: 'PR opened: https://github.com/x/y/pull/1' }, { text: CARD('Use real data. We can always redact later.', '2026-10-30, planning') }, { text: CARD('Later card') }],
  });
  assert.deepEqual(words, { prompt: 'Use real data. We can always redact later.', threadUrl: 'https://app.clickup.com/t/86bcvtyhk', taskId: null });
  // Words of several paragraphs are kept whole.
  assert.equal(danesWords({ url: 'u', tags: [], comments: [{ text: CARD('One.\n\nTwo.') }] }).prompt, 'One.\n\nTwo.');
});

test('a ticket with none of Dane\'s words on record gives none', () => {
  const none = { prompt: null, threadUrl: null, taskId: null };
  assert.deepEqual(danesWords(null), none);
  assert.deepEqual(danesWords({ url: 'u', tags: [], description: '## Goal', comments: [{ text: 'a plain note' }] }), none);
  // A from-wavecenter tag with no block falls back to the card, then to none.
  assert.deepEqual(danesWords({ url: 'u', tags: ['from-wavecenter'], description: '## Goal', comments: [] }), none);
  assert.equal(danesWords({ url: 'u', tags: ['from-wavecenter'], description: '', comments: [{ text: CARD('Asked.') }] }).prompt, 'Asked.');
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

const C = (n) => String(n).repeat(40).slice(0, 40);

test('missingShas picks exactly the changes with no row, oldest first', () => {
  const main = [C(1), C(2), C(3), C(4), C(5)];
  const rows = [
    { commit_sha: C(4), capture_state: 'captured' },
    { commit_sha: C(2), capture_state: 'failed' },
    { commit_sha: C(9), capture_state: 'captured' }, // a row for a change no longer on main
  ];
  assert.deepEqual(missingShas(main, rows), [C(1), C(3), C(5)]);
  assert.deepEqual(missingShas(main, []), main);
  assert.deepEqual(missingShas([], rows), []);
});

test('missingShas run again after a pass that recorded every change captures nothing', () => {
  const main = [C(1), C(2), C(3)];
  const first = missingShas(main, []);
  const rowsAfter = first.map((sha, i) => ({ commit_sha: sha, capture_state: i === 1 ? 'failed' : 'no screen' }));
  assert.deepEqual(missingShas(main, rowsAfter), []);
});

test('missingShas picks a stopped capture up again, since it wrote no row', () => {
  const main = [C(1), C(2), C(3)];
  // Pass one recorded C(1), then was stopped at the time limit part-way through C(2).
  assert.deepEqual(missingShas(main, [{ commit_sha: C(1), capture_state: 'captured' }]), [C(2), C(3)]);
});

test('ticketId reads the task id from a ticket link only', () => {
  assert.equal(ticketId('https://app.clickup.com/t/86bcvtyhk'), '86bcvtyhk');
  assert.equal(ticketId(null), null);
  assert.equal(ticketId('https://example.com/t/86bcvtyhk'), null);
});

test('laneCapturedOnMerge is true only once the merge lane runs missing', () => {
  assert.equal(laneCapturedOnMerge('npm run --silent clickup -- merge-on-comment'), false);
  assert.equal(laneCapturedOnMerge(''), false);
  assert.equal(laneCapturedOnMerge('"$REPO/scripts/run_with_time_limit.sh" 360 -- npm run --silent evolution -- missing 2>&1'), true);
});

test('failureComment says why, that the merge stands, and how to retake it', () => {
  const text = failureComment({ commit_sha: C(7), failure_reason: 'the app at this change did not build: boom' });
  assert.match(text, /could not be taken: the app at this change did not build: boom/);
  assert.match(text, /The merge stands/);
  assert.match(text, /capture 7777777/);
  assert.doesNotMatch(text, /^> /m);
});

// The real run-failure messages scripts/evolution_capture.mjs throws.
const NO_BROWSER = 'the headless browser would not start (browserType.launch: Executable doesn\'t exist at /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome). Install it once with `npx playwright install chromium-headless-shell`.';
const NO_TEST_DB = '`supabase status` did not report the test database. Start it with `npm run db:test` (Docker must be running: `colima status`).';
const NO_KEYS = 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set; run it as `npm run evolution -- …` so Doppler supplies them.';
const BAD_READ = 'could not read evolution_entries: HTTP 503 {"message":"upstream connect error or disconnect/reset before headers. reset reason: connection failure, transport failure reason: delayed connect error: 111 and then a good deal more text after it"}';

/** Run passes through nextRunState the way countRun does, a card always posting. */
function passes(outcomes) {
  let state = null;
  const actions = [];
  for (const o of outcomes) {
    const got = nextRunState(state, o, '2026-11-01T02:16:00Z');
    actions.push(got.action);
    state = got.state;
    if (got.action === 'card') state = { ...state, carded: 'T1', tickets: [...state.tickets, 'T1'] };
    if (got.action === 'recovered') state = null;
  }
  return { actions, state };
}

test('three broken runs in a row with one reason make exactly one card; a fourth adds nothing', () => {
  const broken = { reason: NO_BROWSER };
  const { actions, state } = passes([broken, broken, broken, broken]);
  assert.deepEqual(actions, [null, null, 'card', null]);
  assert.equal(ALERT_AFTER, 3);
  assert.equal(state.count, 4);
  assert.deepEqual(state.tickets, ['T1']);
});

test('the first clean pass after a card notes recovery once, then nothing', () => {
  const broken = { reason: NO_BROWSER };
  const { actions, state } = passes([broken, broken, broken, { ok: true }, { ok: true }]);
  assert.deepEqual(actions, [null, null, 'card', 'recovered', null]);
  assert.equal(state, null);
});

test('a clean pass before any card just clears the count', () => {
  const broken = { reason: NO_BROWSER };
  const { actions } = passes([broken, broken, { ok: true }, broken, broken]);
  assert.deepEqual(actions, [null, null, null, null, null]);
});

test('a changed reason starts its count again, and later gets its own card', () => {
  const { actions, state } = passes([{ reason: NO_BROWSER }, { reason: NO_BROWSER }, { reason: NO_TEST_DB }, { reason: NO_TEST_DB }, { reason: NO_TEST_DB }]);
  assert.deepEqual(actions, [null, null, null, null, 'card']);
  assert.equal(state.reason, NO_TEST_DB);
});

test('the same breakage with different details in brackets or numbers counts as one reason', () => {
  const other = NO_BROWSER.replace('1200', '1217');
  assert.equal(reasonKey(other), reasonKey(NO_BROWSER));
  assert.notEqual(reasonKey(NO_TEST_DB), reasonKey(NO_BROWSER));
  const { actions } = passes([{ reason: NO_BROWSER }, { reason: other }, { reason: NO_BROWSER }]);
  assert.deepEqual(actions, [null, null, 'card']);
});

test('a card that could not be posted is tried again on the next pass', () => {
  const broken = { reason: NO_BROWSER };
  let { state } = nextRunState(null, broken);
  ({ state } = nextRunState(state, broken));
  let got = nextRunState(state, broken);
  assert.equal(got.action, 'card');
  got = nextRunState({ ...got.state, pending: 'T9' }, broken);
  assert.equal(got.action, 'card');
  assert.equal(got.state.pending, 'T9');
});

test('a recovery note that could not be posted is kept for the next clean pass', () => {
  const got = nextRunState({ tickets: ['T1'] }, { ok: true });
  assert.equal(got.action, 'recovered');
  assert.deepEqual(got.state.tickets, ['T1']);
});

test('fixCommand finds the fix the reason names, and only that', () => {
  assert.equal(fixCommand(NO_BROWSER), 'npx playwright install chromium-headless-shell');
  assert.equal(fixCommand(NO_TEST_DB), 'npm run db:test');
  assert.equal(fixCommand(NO_KEYS), null);
  assert.equal(fixCommand(BAD_READ), null);
});

test('the card passes the operator-card rules for every real reason, and is not a costly ask', () => {
  for (const reason of [NO_BROWSER, NO_TEST_DB, NO_KEYS, BAD_READ]) {
    const state = { reason, count: 3, since: '2026-11-01T02:16:00Z', tickets: [] };
    const card = parseCard(runAlertCard(state));
    assert.deepEqual(validateCard(card), [], reason);
    assert.deepEqual(costlyTriggers(card.needed), [], reason);
    assert.match(card.when, /2026-10-31 20:16 MDT/);
    const fix = fixCommand(reason);
    if (fix) assert.ok(card.needed.includes(fix), reason);
    const description = runAlertDescription(state);
    assert.ok(description.includes(reason), 'the whole reason is in the description');
    assert.ok(!/^\s*>/m.test(description), 'no blockquote lines (ClickUp deletes them)');
  }
});

test('the ticket name and recovery note fit the rules', () => {
  assert.equal(nameProblem(RUN_ALERT_NAME), null);
  assert.match(recoveredNote(), /works again/);
});

// ------------------------------------------- retaking after a rules change

test('RULES_FILE is the file that holds choosePage', () => {
  assert.match(readFileSync(RULES_FILE, 'utf8'), /export function choosePage\(/);
});

test('the merge lane retakes after a clean missing, only when the rules changed', () => {
  const lane = readFileSync('scripts/merge_lane.sh', 'utf8');
  const missing = lane.indexOf('evolution -- missing');
  const retake = lane.indexOf('evolution -- recapture --if-rules-changed');
  assert.ok(missing > 0 && retake > missing, 'recapture --if-rules-changed runs after missing');
  assert.match(lane.slice(missing, retake), /if \[ "\$CODE" -eq 0 \]/);
  assert.match(lane, /run_with_time_limit\.sh" \d+ -- npm run --silent evolution -- recapture --if-rules-changed/);
});

test('recaptureDue: a merge that changed the rules owes a retake; one that did not owes nothing', () => {
  assert.equal(recaptureDue({ done: 'aaa' }, 'bbb'), true);
  assert.equal(recaptureDue({ done: 'aaa' }, 'aaa'), false);
  // A new machine has no record, so it checks once; matching rules then retake nothing.
  assert.equal(recaptureDue(null, 'aaa'), true);
  // A failed retake keeps the old fingerprint, so the next pass tries again.
  assert.equal(recaptureDue({ done: 'aaa', failing: 'bbb', told: 'T1' }, 'bbb'), true);
});

test('a successful retake records the rules it used, and no longer owes one', () => {
  const { state, action } = nextRecaptureState({ done: 'aaa' }, 'bbb', { ok: true });
  assert.deepEqual(state, { done: 'bbb' });
  assert.equal(action, null);
  assert.equal(recaptureDue(state, 'bbb'), false);
});

test('a failed retake tells the ticket once, then once more when it works', () => {
  let { state, action } = nextRecaptureState({ done: 'aaa' }, 'bbb', { reason: 'boom' });
  assert.equal(action, 'tell');
  assert.equal(state.done, 'aaa');
  state.told = 'T1';
  ({ state, action } = nextRecaptureState(state, 'bbb', { reason: 'boom again' }));
  assert.equal(action, null);
  assert.equal(state.told, 'T1');
  assert.equal(recaptureDue(state, 'bbb'), true);
  const before = state;
  ({ state, action } = nextRecaptureState(before, 'bbb', { ok: true }));
  assert.equal(action, 'recovered');
  assert.equal(before.told, 'T1');
  assert.deepEqual(state, { done: 'bbb' });
});

test('a note that could not be posted is tried again; a new rules change is told afresh', () => {
  let { state, action } = nextRecaptureState({ done: 'aaa' }, 'bbb', { reason: 'boom' });
  assert.equal(action, 'tell');
  // told left unset: the comment failed.
  ({ action } = nextRecaptureState(state, 'bbb', { reason: 'boom' }));
  assert.equal(action, 'tell');
  ({ state, action } = nextRecaptureState({ ...state, told: 'T1' }, 'ccc', { reason: 'boom' }));
  assert.equal(action, 'tell');
  assert.equal(state.told, null);
});

test('a retake cut off at the time limit keeps trying while it retakes cards, and tells once when stuck', () => {
  // Cut off after retaking a card: progress, say nothing, still owed.
  let { state, action } = nextRecaptureState({ done: 'aaa' }, 'bbb', { stopped: true, progressed: true });
  assert.equal(action, null);
  assert.equal(state.done, 'aaa');
  assert.equal(state.cutoffs, 0);
  assert.equal(recaptureDue(state, 'bbb'), true);
  // Cut off with nothing retaken: counted, quiet until the limit.
  for (let i = 1; i < RECAPTURE_CUTOFF_LIMIT; i++) {
    ({ state, action } = nextRecaptureState(state, 'bbb', { stopped: true, progressed: false }));
    assert.equal(action, null);
    assert.equal(state.cutoffs, i);
  }
  ({ state, action } = nextRecaptureState(state, 'bbb', { stopped: true, progressed: false }));
  assert.equal(action, 'tell');
  assert.match(state.reason, new RegExp(`cut off at the time limit ${RECAPTURE_CUTOFF_LIMIT} passes running`));
  state.told = 'T1';
  // Told once: further cut-offs say nothing, and the first success says done.
  ({ state, action } = nextRecaptureState(state, 'bbb', { stopped: true, progressed: false }));
  assert.equal(action, null);
  assert.equal(state.told, 'T1');
  ({ state, action } = nextRecaptureState(state, 'bbb', { ok: true }));
  assert.equal(action, 'recovered');
  assert.deepEqual(state, { done: 'bbb' });
});

test('a cut-off under new rules starts its count afresh', () => {
  const { state } = nextRecaptureState({ done: 'aaa', failing: 'bbb', cutoffs: 2, told: null }, 'ccc', { stopped: true, progressed: false });
  assert.equal(state.cutoffs, 1);
  assert.equal(state.failing, 'ccc');
});

test('another run holding the test database is not a failure: nothing changes, nobody is told', () => {
  const before = { done: 'aaa', failing: 'bbb', cutoffs: 1, told: null };
  const { state, action } = nextRecaptureState(before, 'bbb', { busy: true });
  assert.equal(action, null);
  assert.deepEqual(state, before);
  assert.equal(recaptureDue(state, 'bbb'), true);
  assert.equal(nextRecaptureState(null, 'bbb', { busy: true }).action, null);
});

test('the lane step records a cut-off before exiting, and skips the GitHub lookup while scanning', () => {
  const src = readFileSync('scripts/evolution_capture.mjs', 'utf8');
  assert.match(src, /outcome = \{ stopped: true, progressed: got\.retaken > 0 \}/);
  assert.match(src, /class Busy extends RunFailed/);
  assert.match(src, /throw new Busy\(`another run is using the test database/);
  assert.match(src, /recapture\(\{ newNeighboursOnly: true, out: got \}\)/);
  assert.match(src, /commitInfo\(row\.commit_sha, \{ ticket: false \}\)/);
});

test('the retake notes say what happened and that the old cards stand', () => {
  const failed = recaptureFailedComment('the app at this change did not build: boom');
  assert.match(failed, /it failed: the app at this change did not build: boom/);
  assert.match(failed, /left exactly as they were/);
  assert.match(failed, /will not repeat this one/);
  assert.match(recaptureDoneNote('retook 4, left off 0 identical picture(s), kept 12'), /\(retook 4, .*kept 12\)/);
});

test('a card whose ticket names no WaveCenter task is named in the run output, and one that does is not', () => {
  const TASK = '0f5c2b7e-1a2b-4c3d-8e9f-0123456789ab';
  assert.equal(noTaskLine({ url: 'https://app.clickup.com/t/abc', description: `## From WaveCenter\n\n\`\`\`\nHi\n\`\`\`\n\nWaveCenter task: ${TASK}\n` }), null);
  const missing = noTaskLine({ url: 'https://app.clickup.com/t/abc', description: 'A spec with no task line.' });
  assert.match(missing, /NO WAVECENTER TASK/);
  assert.match(missing, /https:\/\/app\.clickup\.com\/t\/abc/);
  assert.match(noTaskLine({ id: 'abc', description: '' }, 'https://app.clickup.com/t/abc'), /ticket https:\/\/app\.clickup\.com\/t\/abc names no WaveCenter task/);
  assert.match(noTaskLine(null), /names no ticket/);
  // A task line in passing, not on its own line, does not count.
  assert.match(noTaskLine({ url: 'u', description: `see WaveCenter task: ${TASK} elsewhere` }), /NO WAVECENTER TASK/);
});
