/**
 * The pure rules behind the Evolution screenshots (scripts/evolution_capture.mjs):
 * which page a change is pictured on, what the live data looked like at the
 * moment it merged, and the row each change gets in `evolution_entries`.
 * Tested in evolution.test.mjs; nothing here touches git, a database or a
 * browser.
 */

export const CAPTURE_STATES = ['captured', 'no screen', 'failed'];

/** The bucket the screenshots live in (private; members read, only the script writes). */
export const BUCKET = 'evolution';

/** A merge commit's subject, "<PR title> (#12)", split into the title and the PR number. */
export function parseSubject(subject) {
  const s = String(subject || '').trim();
  const m = s.match(/^(.*\S)\s+\(#(\d+)\)$/);
  return m ? { title: m[1], prNumber: Number(m[2]) } : { title: s, prNumber: null };
}

/** The first ClickUp ticket link in a PR body, or null. */
export function ticketUrl(text) {
  const m = String(text || '').match(/https:\/\/app\.clickup\.com\/t\/[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;

/** The route directories that have a page at this commit, e.g. "", "tasks", "tasks/[id]". */
function routeDirs(files) {
  const dirs = new Set();
  for (const f of files) {
    if (!f.startsWith('app/')) continue;
    const parts = f.slice(4).split('/');
    if (PAGE_FILE.test(parts.at(-1))) dirs.add(parts.slice(0, -1).join('/'));
  }
  return dirs;
}

/** The route a changed file under app/ belongs to: its deepest page folder, '' for app/page.tsx, or null (shared). */
function routeOf(file, dirs) {
  const parts = file.slice(4).split('/').slice(0, -1);
  for (let n = parts.length; n >= 1; n -= 1) {
    const dir = parts.slice(0, n).join('/');
    if (dirs.has(dir)) return dir;
  }
  return parts.length === 0 && PAGE_FILE.test(file.slice(4)) && dirs.has('') ? '' : null;
}

const HOME_WORDS = /\b(home|dashboard)\b/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The top-level pages `text` names, in the order it names them: "home" or
 * "dashboard" for the Home page, otherwise a page's own address word
 * ("game", "profile", "members", "tasks", ...), whole words only.
 */
function namedPages(text, dirs) {
  const t = String(text || '');
  const found = [];
  const home = t.match(HOME_WORDS);
  if (home && dirs.has('')) found.push({ dir: '', at: home.index });
  for (const dir of dirs) {
    if (!dir || dir.includes('/') || dir.includes('[')) continue;
    const m = t.match(new RegExp(`(^|[^\\w-])${escapeRe(dir)}(?![\\w-])`, 'i'));
    if (m) found.push({ dir, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.dir);
}

/** A ticket name's fix, the part after "<what breaks and who feels it>: ". */
function fixPart(title) {
  const t = String(title || '');
  const at = t.indexOf(': ');
  return at > 0 ? t.slice(at + 2) : t;
}

/**
 * Which page to photograph for one change, or null for "no screen".
 *
 *   changed: the paths the change touched
 *   added:   the paths it added (a subset of changed)
 *   files:   every path in the repository at that change
 *   title:   the PR title; prompt: Dane's words behind it, when on record
 *
 * Every changed file under app/ belongs to a page: the deepest page folder
 * that holds it (app/game/leaderboard/page.tsx is /game/leaderboard; a
 * dynamic folder comes back as "/tasks/[id]", and the capture puts a real
 * task's id in its place), or / for app/page.tsx. Files that belong to no
 * page (app/SiteHeader.tsx, app/globals.css, app/lib/, app/layout.tsx,
 * app/auth/, or a folder whose page does not exist yet) are shared.
 *
 * When the change touched a page, the most relevant touched page wins:
 *   1. one the title names ("Dane wants a tidier Home: ..." is /; #54, which
 *      added /about, /deo and /tasks but was about the new Home, is /);
 *   2. then one the change added (#30 added /profile);
 *   3. then the one with the most changed files;
 *   4. then the shorter address (a section and its sub-pages is the section).
 * Shared files no longer vote: a game page change that also touched
 * app/lib/ is /game, not Home (Dane, 2026-11-01: "show the most relevant
 * screenshot").
 *
 * When only shared files changed, the page the fix names decides (the part
 * of the title after ": ", then Dane's words), else the Home page / when it
 * exists, else /tasks. Until the Home dashboard (#54) the task list itself
 * lived at /.
 *
 * The same page on two cards in a row is fine: the page a change is about
 * is pictured as it looks now, so the cards show how each page changes over
 * time (Dane, 2026-11-01: "the image itself should be unique, not the
 * page"). Only an identical picture is left off, when it is taken.
 *
 * No app/ change, or no page at all at that change: null.
 */
export function choosePage({ changed, added, files, title, prompt }) {
  const dirs = routeDirs(files || []);
  if (!dirs.size) return null;
  const appChanges = (changed || []).filter((f) => f.startsWith('app/'));
  if (!appChanges.length) return null;

  const votes = new Map();
  for (const f of appChanges) {
    const route = routeOf(f, dirs);
    if (route !== null) votes.set(route, (votes.get(route) || 0) + 1);
  }

  if (!votes.size) {
    const named = [...namedPages(fixPart(title), dirs), ...namedPages(prompt, dirs)];
    if (named.length) return `/${named[0]}`;
    return dirs.has('') ? '/' : dirs.has('tasks') ? '/tasks' : null;
  }

  const inTitle = new Set(namedPages(title, dirs));
  const addedPages = new Set((added || []).filter((f) => f.startsWith('app/') && PAGE_FILE.test(f.split('/').at(-1))).map((f) => f.slice(4).split('/').slice(0, -1).join('/')));
  const ranked = [...votes.keys()].sort((a, b) =>
    (inTitle.has(b) - inTitle.has(a))
    || (addedPages.has(b) - addedPages.has(a))
    || (votes.get(b) - votes.get(a))
    || a.length - b.length
    || a.localeCompare(b)).map((d) => `/${d}`);
  return ranked[0];
}

/** Whether a stored page (/tasks/<id>) is the page pattern (/tasks/[id]) choosePage gives. */
export function samePage(pattern, page) {
  if (pattern == null || page == null) return pattern === page;
  const re = new RegExp(`^${pattern.split(/\[[^\]]+\]/).map(escapeRe).join('[^/]+')}$`);
  return re.test(page);
}

/** The captured card just before a change merged at `mergedAt` (rows as stored), or null. */
export function previousCard(rows, mergedAt) {
  const t = Date.parse(mergedAt);
  return (rows || [])
    .filter((r) => r.capture_state === 'captured' && Date.parse(r.merged_at) < t)
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))[0] ?? null;
}

/** Fill a dynamic page such as /tasks/[id] with a task that existed then; null if there was none. */
export function fillPage(page, tasks) {
  if (!page || !page.includes('[')) return page;
  const newest = [...(tasks || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  return newest ? page.replace(/\[[^\]]+\]/, newest.id) : null;
}

/**
 * The tables copied into the local database, and what "existed by then"
 * means for each. Rows in a table with `created_at` count from that moment.
 * Tables keyed only by member (settings, profile, role) have no creation
 * time, so they count once their member exists. The reference lists (roles,
 * permissions, scoring rules) come from that change's own migrations, not
 * from live.
 */
export const COPIED_TABLES = ['tasks', 'task_comments', 'task_votes', 'task_files', 'engagements', 'member_settings', 'member_profiles', 'member_roles'];

const MEMBER_COLUMNS = ['owner_id', 'member_id'];

/**
 * The live rows as they stood at `mergedAt`, shaped for a database that has
 * only `columns` (table -> list of column names; a table missing from it did
 * not exist at that change and is skipped).
 *
 *   live: { users: [auth users], tables: { name: [rows] } }
 *
 * Returns { users, tables } holding only what existed by then: members whose
 * account was made by then; tasks made by then, done only if completed by
 * then (otherwise open); every other row made by then, belonging to members
 * and tasks that existed by then. Columns the old database lacks are dropped.
 */
export function asOf(live, { mergedAt, columns }) {
  const t = Date.parse(mergedAt);
  if (Number.isNaN(t)) throw new Error(`asOf: not a time: ${mergedAt}`);
  const by = (iso) => iso != null && Date.parse(iso) <= t;

  const users = (live.users || []).filter((u) => by(u.created_at));
  const memberIds = new Set(users.map((u) => u.id));
  const tables = {};

  const keep = (name, rows) => {
    const cols = columns[name];
    if (!cols) return;
    tables[name] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => cols.includes(k))));
  };
  const ownedByMember = (r) => MEMBER_COLUMNS.every((c) => !(c in r) || r[c] == null || memberIds.has(r[c]));

  const liveTasks = (live.tables?.tasks || []).filter((r) => by(r.created_at) && ownedByMember(r));
  const taskIds = new Set(liveTasks.map((r) => r.id));
  const tasks = liveTasks.map((r) => {
    const row = { ...r };
    if (row.parent_task_id && !taskIds.has(row.parent_task_id)) row.parent_task_id = null;
    if (row.updated_at && !by(row.updated_at)) row.updated_at = mergedAt;
    if (row.status === 'done' && !by(row.completed_at)) {
      row.status = 'todo';
      row.completed_at = null;
    } else if (row.status !== 'done') {
      row.completed_at = null;
    }
    return row;
  });
  keep('tasks', tasks);

  const commentIds = new Set();
  for (const name of COPIED_TABLES) {
    if (name === 'tasks') continue;
    const rows = (live.tables?.[name] || []).filter((r) =>
      ('created_at' in r ? by(r.created_at) : true)
      && ownedByMember(r)
      && (!('task_id' in r) || r.task_id == null || taskIds.has(r.task_id))
      && (!('comment_id' in r) || r.comment_id == null || commentIds.has(r.comment_id)));
    if (name === 'task_comments') for (const r of rows) commentIds.add(r.id);
    keep(name, rows);
  }
  return { users, tables };
}

/**
 * The `evolution_entries` row for one change. Refuses a `captured` row with
 * no stored screenshot and a `failed` row with no reason (rule 6: never say
 * a picture is there when it is not).
 */
export function entryRow({ sha, mergedAt, prNumber, title, ticketUrl: ticket, page, screenshotPath, state, reason, prompt, threadUrl }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error(`entryRow: not a full commit id: ${sha}`);
  if (!CAPTURE_STATES.includes(state)) throw new Error(`entryRow: unknown capture state "${state}"`);
  if (state === 'captured' && (!page || !screenshotPath)) throw new Error('entryRow: a captured row needs its page and its stored screenshot');
  if (state === 'failed' && !String(reason || '').trim()) throw new Error('entryRow: a failed row needs a reason');
  return {
    commit_sha: sha,
    merged_at: mergedAt,
    pr_number: prNumber ?? null,
    title,
    ticket_url: ticket ?? null,
    page: page ?? null,
    screenshot_path: state === 'captured' ? screenshotPath : null,
    capture_state: state,
    failure_reason: state === 'failed' ? String(reason).trim().slice(0, 500) : null,
    prompt: prompt ?? null,
    thread_url: prompt ? (threadUrl ?? null) : null,
  };
}

/** The tag loop-handoff puts on a ticket it filed from a WaveCenter task. */
const FROM_WAVECENTER_TAG = 'from-wavecenter';
/** The heading every operator card opens with (scripts/lib/operatorCard.mjs, cardBlocks). */
const CARD_HEADING = "DANE'S WORDS — the instruction behind this ticket";
const CARD_NEXT_HEADING = "WHAT'S GOING ON";

/** The fenced title and notes under a ticket's "## From WaveCenter" heading, and the task it names. */
function fromWaveCenter(description) {
  const text = String(description || '');
  const m = text.match(/^##\s*From WaveCenter\s*\n+\s*```[^\n]*\n([\s\S]*?)\n\s*```/m);
  if (!m) return null;
  const task = text.match(/^WaveCenter task:\s*([0-9a-f-]{36})\s*$/m);
  return { words: m[1].trim(), taskId: task ? task[1] : null };
}

/**
 * The @@ASKED words of the first operator card in `comments` (oldest first,
 * each { text }), as ClickUp stores the card: the heading, his words, an
 * optional "(when)" line, then "WHAT'S GOING ON".
 */
function firstCardWords(comments) {
  for (const c of comments || []) {
    const text = String(c?.text || '').replace(/\r\n/g, '\n');
    const at = text.indexOf(CARD_HEADING);
    if (at < 0) continue;
    let words = text.slice(at + CARD_HEADING.length);
    const end = words.indexOf(`\n${CARD_NEXT_HEADING}`);
    if (end < 0) continue;
    const paragraphs = words.slice(0, end).trim().split(/\n\s*\n/);
    if (paragraphs.length > 1 && /^\([^\n]*\)$/.test(paragraphs.at(-1).trim())) paragraphs.pop();
    words = paragraphs.join('\n\n').trim();
    if (words) return words;
  }
  return null;
}

/**
 * Dane's own words behind a change, and the link to where they were said,
 * read from its ClickUp ticket (`npm run clickup -- ticket-json`):
 *
 * - a ticket tagged from-wavecenter: the WaveCenter task's title and notes
 *   from its "## From WaveCenter" block, linking to that task (/tasks/<id>,
 *   an address on WaveCenter itself, whatever its host);
 * - any other ticket: the @@ASKED words of its first operator card,
 *   linking to the ticket.
 *
 * Verbatim, whitespace trimmed. { prompt: null, threadUrl: null } when the
 * ticket holds none of his words.
 */
export function danesWords(ticket) {
  const none = { prompt: null, threadUrl: null };
  if (!ticket) return none;
  if ((ticket.tags || []).includes(FROM_WAVECENTER_TAG)) {
    const from = fromWaveCenter(ticket.description);
    if (from?.words) return { prompt: from.words, threadUrl: from.taskId ? `/tasks/${from.taskId}` : (ticket.url ?? null) };
  }
  const asked = firstCardWords(ticket.comments);
  return asked ? { prompt: asked, threadUrl: ticket.url ?? null } : none;
}

/** A time as a Mountain-time date and clock, e.g. "2026-10-30 14:05 MDT". */
export function mountain(iso) {
  const d = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

/** One line of `npm run evolution -- list`. */
export function listLine(row) {
  const state = row.capture_state === 'failed' ? `failed (${row.failure_reason})` : row.capture_state;
  return [String(row.commit_sha).slice(0, 7), mountain(row.merged_at), state, row.page || '-', row.title].join('\t');
}

/**
 * The changes `npm run evolution -- missing` captures: every one in `shas`
 * (main's first-parent commits, oldest first) that has no row yet, in the
 * same order. Any row counts, `failed` included, so a failure is recorded
 * once and never retried on its own; a capture that was stopped part-way
 * wrote no row, so the next pass picks it up again.
 */
export function missingShas(shas, rows) {
  const have = new Set((rows || []).map((r) => r.commit_sha));
  return (shas || []).filter((sha) => !have.has(sha));
}

/** The ClickUp task id in a ticket link, or null. */
export function ticketId(url) {
  const m = String(url || '').match(/^https:\/\/app\.clickup\.com\/t\/([A-Za-z0-9]+)$/);
  return m ? m[1] : null;
}

/**
 * Whether the merge lane that merged a change was already taking its
 * picture, read from scripts/merge_lane.sh as it stood just before the
 * change (its first parent). Only those tickets hear about a failed
 * picture; older changes caught up later keep the reason on their row alone.
 */
export function laneCapturedOnMerge(mergeLaneBefore) {
  return /evolution\s+--\s+missing/.test(String(mergeLaneBefore || ''));
}

/** The one plain comment a ticket gets when its picture could not be taken. */
export function failureComment(row) {
  return [
    `The Evolution screenshot for this change could not be taken: ${row.failure_reason}`,
    '',
    `The merge stands and nothing about this ticket changes. The change is recorded as "failed" in the Evolution history (commit ${String(row.commit_sha).slice(0, 7)}), so it will not be tried again on its own; \`npm run evolution -- capture ${String(row.commit_sha).slice(0, 7)}\` on the Mac Mini retakes it.`,
  ].join('\n');
}

// ------------------------------------------------- when the run itself breaks

/** Consecutive broken runs, with the same reason, before Dane is told. */
export const ALERT_AFTER = 3;

/**
 * A run-failure reason with its changing details taken out (the words in
 * brackets, the numbers), so the same breakage reads the same every pass.
 */
export function reasonKey(reason) {
  return String(reason || '').replace(/\([^)]*\)/g, '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/** The one command the reason itself names as its fix ("Install it once with `…`"), or null. */
export function fixCommand(reason) {
  const m = String(reason || '').match(/(?:with|Run) `([^`]+)`/);
  return m ? m[1] : null;
}

/**
 * The next state of the run-failure counter after one `missing` pass, and
 * what to do about it. `state` is what the last pass left (null: nothing is
 * wrong); `outcome` is { reason } for a broken run, or { ok: true }.
 *
 *   action 'card'       this pass is the ALERT_AFTER-th in a row with the
 *                       same reason and no card has been posted for it yet
 *   action 'recovered'  the run works again after a card: note it on
 *                       state.tickets, then clear the state
 *   action null         nothing to say
 *
 * A card that could not be posted leaves `carded` unset, so the next pass
 * tries again. `tickets` keeps every card of this outage (a new reason gets
 * its own card) until the recovery note has been posted on each.
 */
export function nextRunState(state, outcome, now = new Date().toISOString()) {
  const tickets = state?.tickets ?? [];
  if (outcome?.ok) {
    if (!tickets.length) return { state: null, action: null };
    return { state: { tickets }, action: 'recovered' };
  }
  const key = reasonKey(outcome?.reason);
  const same = state?.key === key;
  const next = {
    key,
    reason: outcome?.reason ?? '',
    count: same ? state.count + 1 : 1,
    since: same ? state.since : now,
    carded: same ? state.carded ?? null : null,
    tickets,
  };
  if (state?.pending) next.pending = state.pending;
  return { state: next, action: next.count >= ALERT_AFTER && !next.carded ? 'card' : null };
}

/** The ticket name the merge lane files when picture-taking stops. */
export const RUN_ALERT_NAME = 'Evolution pictures have stopped: the Mac Mini cannot take them';

const LANE_LOG = '~/loop-logs/wavecenter-merge-on-comment.log';

function firstWords(text, n) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  return words.length > n ? `${words.slice(0, n).join(' ')} …` : words.join(' ');
}

function fixLine(reason) {
  const cmd = fixCommand(reason);
  return cmd ? `runs \`${cmd}\` in the main checkout` : `reads the last lines of \`${LANE_LOG}\` and fixes what they name`;
}

/** The left-hand description of that ticket: the whole reason and the fix. */
export function runAlertDescription(state) {
  return [
    '## Goal',
    'Picture-taking for the Home "Evolution of WaveCenter" row works again on the Mac Mini.',
    '',
    '## What happened',
    `The merge lane's \`npm run evolution -- missing\` step has failed ${state.count} passes in a row (every 10 minutes, since ${mountain(state.since)}) for one reason, so no newly merged change gets its Evolution card:`,
    '',
    '```',
    state.reason,
    '```',
    '',
    'Each pass writes the same line to `' + LANE_LOG + '` on the Mac Mini. Merges themselves are not affected.',
    '',
    '## Scope',
    `*   On the Mac Mini, the agent session ${fixLine(state.reason)}.`,
    '*   Then `npm run evolution -- missing` from the main checkout, and see it end with `missing: …` and exit 0.',
    '*   No code change is expected. If the fix needs one, file it as its own ticket.',
    '',
    '## Acceptance criteria',
    '- [ ] The next merge-lane pass ends `/evolution-missing (exit 0)` in the lane log.',
    '- [ ] This ticket carries the merge lane\'s "picture-taking works again" note.',
  ].join('\n');
}

/** The operator card on that ticket (scripts/lib/operatorCard.mjs shape). */
export function runAlertCard(state) {
  return [
    '@@ASKED',
    'No instruction from Dane: the merge lane raised this on its own. It descends from the Evolution row on Home, which shows a picture of every change merged into main.',
    '@@WHEN',
    `from ${mountain(state.since)}, the merge lane on the Mac Mini`,
    '@@CONTEXT',
    `The Mac Mini has not been able to take any Evolution pictures for ${state.count} merge-lane passes in a row, so changes merged since then are missing from the Evolution row on Home. Merging still works. The reason it gives: ${firstWords(state.reason, 20)} The whole message is in the description. The fix is on the machine itself, not in the code, and this card gets a note as soon as pictures work again.`,
    '@@NEEDED',
    `Your go-ahead: reply **fix it** and the next agent session on the Mac Mini ${fixLine(state.reason)}, then checks that pictures work again. If they start working first, this card gets a note and you can close the ticket.`,
  ].join('\n');
}

/** The one note a card's ticket gets when the run works again. */
export function recoveredNote() {
  return 'Picture-taking works again: the last merge-lane pass took the Evolution pictures it owed and finished cleanly. Nothing more is needed for this card; the ticket can be closed.';
}
