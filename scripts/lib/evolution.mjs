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
 *   previousPage: the page the card before it shows (the repeat rule)
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
 * Repeat rule (Dane: "no single screenshot should be repeated"): when the
 * winner is the page the card before shows and the change touched another
 * page, the next one wins instead.
 *
 * No app/ change, or no page at all at that change: null.
 */
export function choosePage({ changed, added, files, title, prompt }, { previousPage = null } = {}) {
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
  if (ranked.length > 1 && previousPage != null && samePage(ranked[0], previousPage)) return ranked[1];
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
