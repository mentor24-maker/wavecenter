import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubject, ticketUrl, choosePage, samePage, previousCard, fillPage, asOf, entryRow, mountain, listLine, missingShas, ticketId, laneCapturedOnMerge, failureComment, danesWords } from './evolution.mjs';

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

test('the repeat rule: a card does not show the same page as the card before when the change touched another', () => {
  const changed = ['app/page.tsx', 'app/tasks/Evolution.tsx'];
  assert.equal(choosePage({ changed, files: WITH_HOME }), '/');
  assert.equal(choosePage({ changed, files: WITH_HOME }, { previousPage: '/' }), '/tasks');
  // With nothing else touched, the page stays.
  assert.equal(choosePage({ changed: ['app/page.tsx'], files: WITH_HOME }, { previousPage: '/' }), '/');
  assert.equal(choosePage({ changed: ['app/SiteHeader.tsx'], files: WITH_HOME }, { previousPage: '/' }), '/');
  // A stored task page counts as the same page as its pattern.
  assert.equal(choosePage({ changed: ['app/tasks/[id]/TaskDiscussion.tsx', 'app/tasks/[id]/page.tsx', 'app/members/page.tsx'], files: WITH_HOME }, { previousPage: '/tasks/abc' }), '/members');
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
});

test('any other ticket gives the first card\'s asked words, without its when line, linking to the ticket', () => {
  const words = danesWords({
    url: 'https://app.clickup.com/t/86bcvtyhk',
    tags: ['evolution'],
    description: '## Goal\nx',
    comments: [{ text: 'PR opened: https://github.com/x/y/pull/1' }, { text: CARD('Use real data. We can always redact later.', '2026-10-30, planning') }, { text: CARD('Later card') }],
  });
  assert.deepEqual(words, { prompt: 'Use real data. We can always redact later.', threadUrl: 'https://app.clickup.com/t/86bcvtyhk' });
  // Words of several paragraphs are kept whole.
  assert.equal(danesWords({ url: 'u', tags: [], comments: [{ text: CARD('One.\n\nTwo.') }] }).prompt, 'One.\n\nTwo.');
});

test('a ticket with none of Dane\'s words on record gives none', () => {
  const none = { prompt: null, threadUrl: null };
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
