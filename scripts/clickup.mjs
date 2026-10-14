#!/usr/bin/env node
/**
 * clickup.mjs — WaveCenter's one door into ClickUp: read the Loop Queue,
 * claim a ticket, move statuses, hand work to Dane and record the PR and
 * review trails. It talks to ClickUp's own REST API, never the claude.ai
 * connector (whose shared budget starves under loop traffic).
 *
 * A seed-sized copy of StarCaster's scripts/clickup_direct.mjs: the same
 * commands, the same guards, the same ids, with the StarCaster-only machinery
 * (bus relay, auto-merge lanes, pacing, heartbeat) left out until WaveCenter
 * needs it. One lane came over on 2026-10-11 at Dane's request: his written
 * "merge" on a Ready to launch ticket is carried out (`merge-on-comment`).
 *
 * The token comes from the environment, never printed and never logged.
 * package.json wraps this in `doppler run --project wavecenter --config dev`,
 * so no agent or human handles the value:
 *
 *   npm run clickup -- whoami
 *
 * Run `npm run clickup` bare for the command list. Data goes to stdout
 * (tab-separated where a caller would parse it); counts and diagnostics go to
 * stderr, so piping stdout is always safe.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  DISPLAY, STAGE_ORDER, CLAIMABLE_BY_BUILD, OPERATOR_STATUSES, BUILDING, PRIORITY_VALUE,
  READY_TO_LAUNCH, NEEDS_YOUR_INPUT, QUEUED, LIVE,
  isClaimableByBuild, isOperatorStatus, isReadyToLaunch, claimOrder, buildOrder, compareWithinStatus, statusOf,
} from './lib/loopStatuses.mjs';
import {
  prOpenedComment, verdictComment, commentsReadable, prTrailLanded, bodyNamesTicket,
  readyToLaunchGate, nextRound, wouldEscalate, roundSummaryLines, sendBackRounds, operatorSpokeLast,
  findPullRequest, newestFirst, ESCALATE_AT_ROUND,
} from './lib/loopTrail.mjs';
import { buildCard, cardSurvived, findBlockquoteLines, CONTEXT_MIN_WORDS, CONTEXT_MAX_WORDS } from './lib/operatorCard.mjs';
import { stampCommentBody, isCommentPostPath, isMachineComment, stripMachineMarker } from './lib/machineComment.mjs';
import {
  nextHandOff, recordHandOff, serviceDb, syncBack, taskLine, ticketPriority as ticketPriorityOf, ticketUrl, FROM_WAVECENTER_TAG,
} from './lib/handoff.mjs';
import { CoreError, LOOP_HANDOFF_TOOL } from '../core/tool.ts';
import {
  findAuthorization, danesAnswer, refusalNotice, alreadyNoticed, prDecision, mergedComment, mergeRecorded, MERGE_PHRASES,
  conflictToSettle, settledLine, notSettledLine, settleCardProblem, SETTLE_TODO,
} from './lib/mergeWords.mjs';

// ── The ids, written down once ───────────────────────────────────────────────
// Everything here is overridable from the environment, so a moved list or a
// renamed seat is a one-line change in Doppler, not a code change.
const TOKEN = process.env.CLICKUP_API_TOKEN;
export const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
export const SPACE = process.env.CLICKUP_SPACE_ID || '90146476554';            // the WaveCenter SPACE
export const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901422159126'; // the Loop Queue LIST
/** Dane's seat (dane@alphire.agency). Every handoff assigns this id. The token
 *  ALSO acts as this seat (`whoami` says so), which is why every comment this
 *  script posts is stamped with the machine marker — see lib/machineComment.mjs. */
export const OPERATOR_ID = Number(process.env.CLICKUP_OPERATOR_ID || 48012725);
/** Pulse / mentor24 — the workspace's service account. NEVER assign it. */
export const MACHINE_ID = Number(process.env.CLICKUP_MACHINE_ID || 54254347);
const API = process.env.CLICKUP_API_BASE || 'https://api.clickup.com';
const HTTP_TIMEOUT_MS = Number(process.env.CLICKUP_HTTP_TIMEOUT_MS) || 60 * 1000;

const PRIORITY = PRIORITY_VALUE;

// ── Argument helpers ─────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }
function readBody(spec) { return spec === '-' ? readFileSync(0, 'utf8') : readFileSync(spec, 'utf8'); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── The HTTP door ────────────────────────────────────────────────────────────
let requests = 0;
const limits = { limit: null, remaining: null, reset: null };

function unreachable(err) {
  return { res: { ok: false, status: 0, headers: { get: () => null } }, json: null, text: `the request never reached ClickUp (${err?.message || err})` };
}

async function callOnce(method, path, body) {
  requests += 1;
  // THE ONE PLACE A MACHINE COMMENT IS MARKED. The loops post under Dane's own
  // seat, so a reader cannot tell their writing from his by author alone.
  const sendBody = (method === 'POST' && isCommentPostPath(path)) ? stampCommentBody(body) : body;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
      body: sendBody ? JSON.stringify(sendBody) : undefined,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    return unreachable(err);
  }
  limits.limit = res.headers.get('x-ratelimit-limit') ?? limits.limit;
  limits.remaining = res.headers.get('x-ratelimit-remaining') ?? limits.remaining;
  limits.reset = res.headers.get('x-ratelimit-reset') ?? limits.reset;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { res, json, text };
}

/** A 429 is ClickUp itself throttling; it clears within a minute and is safe to repeat. */
async function call(method, path, body) {
  for (let attempt = 1; ; attempt += 1) {
    const out = await callOnce(method, path, body);
    if (out.res.status !== 429 || attempt >= 3) return out;
    const reset = Number(out.res.headers.get('x-ratelimit-reset'));
    const waitMs = Number.isFinite(reset) && reset > 0 ? Math.max(1000, reset * 1000 - Date.now()) : 15000;
    console.error(`  ClickUp rate limit (attempt ${attempt}) — waiting ${Math.round(waitMs / 1000)}s and trying again`);
    await sleep(Math.min(waitMs, 65000));
  }
}

function reportLimits() {
  if (limits.limit == null && limits.remaining == null) return;
  console.error(`  ClickUp's own limit: ${limits.remaining ?? '?'} of ${limits.limit ?? '?'} left this minute (${requests} request(s) this run)`);
}

function die(label, { res, json, text }) {
  console.error(`\n${label} FAILED — HTTP ${res.status}`);
  console.error(json?.err || json?.error || String(text || '').slice(0, 500));
  if (res.status === 401) {
    if (/team not authorized/i.test(String(json?.err || json?.error || text))) {
      console.error('\n"Team not authorized" usually means the ID is the wrong KIND of thing — a space id where a');
      console.error(`list id belongs (the WaveCenter SPACE is ${SPACE}; the Loop Queue LIST is ${LOOP_QUEUE_LIST}).`);
      console.error('Run `npm run clickup -- lists` to resolve list ids by name before blaming the token.');
    } else {
      console.error('\n401 means the token is wrong or expired — not that ClickUp is down.');
      console.error('The token lives in Doppler (wavecenter/dev, CLICKUP_API_TOKEN, a reference to starcaster/dev).');
      console.error('Run through `npm run clickup -- ...` so Doppler supplies it.');
    }
  }
  if (res.status === 429) console.error('\n429 is ClickUp throttling; wait 60s and run the same command again.');
  if (res.status === 0) console.error('\nHTTP 0: the request never left this machine or never arrived. Check the network and run it again.');
  process.exit(1);
}

function usage(code = 2) {
  console.error(`
npm run clickup -- <command> [flags]      (WaveCenter Loop Queue: list ${LOOP_QUEUE_LIST}, space ${SPACE})

  whoami                                          prove the token works and say who it acts as
  lists [--space <id>]                            resolve list ids by name (default: the WaveCenter space)
  queue [--list <id>] [--claimable | --status S]  the tickets, one per line: id, status, priority, created, name
  get --task <id>                                 header + body
  task-name --task <id>                           the name and nothing else (for a PR title)
  comments --task <id>                            the comments, oldest first
  waiting [--task <id>]                           read-only: is this ACTUALLY waiting on Dane? exit 0 no / 3 yes / 1 could not tell
  task --name "..." --body-file <f|-> [--list <id>] [--status S] [--priority p] [--tags a,b] [--id-out <file>]
  describe --task <id> --body-file <f|->          REPLACE the description (the left column)
  comment --task <id> --body-file <f|->           a plain note
  claim --task <id>                               safe claim: reads the status and guards the write on it
  status --task <id> --status S [--if-status S] [--assign <uid>] [--clear-assignees] [--no-auto-assign] [--no-card]
  ask --task <id> [--status "Needs your input"|"Ready to launch"] --body-file <f|-> [--no-move] [--after-his-answer]
  pr-opened --task <id> --pr <url|number> [--repo owner/name] [--if-missing] [--body-file <f|->]
  verdict --task <id> --pass|--fail --if-status "In review" [--body-file <f|->] [--no-guard] [--fourth-round-anyway]
  priority --task <id> --priority urgent|high|normal|low [--operator-asked]
  tag --task <id> --add <name> | --remove <name>  e.g. wont-do, deferred, an epic name
  settle --task <id>                              read-only: does this Ready to launch ticket's PR need its conflict
                                                  settled by the build loop? exit 0 yes (prints the branch) / 3 no
  settled --task <id> --body-file <f|->           record it settled (refuses unless GitHub reads MERGEABLE); no status change
  settle-blocked --task <id> --body-file <f|->    the conflict needs his choice: an operator card, Dane assigned, no status change
  merge-on-comment [--dry-run]                    the merge lane: carry out Dane's written "${MERGE_PHRASES[0]}" on Ready to launch
                                                  tickets, and requeue Needs your input tickets he has answered
  handoff-next                                    the loop-handoff lane: the next ticked WaveCenter task, as JSON
                                                  (exit 0), or why there is none (exit 3)
  handoff-record --task <wavecenter-id> --ticket <clickup-id>
                                                  record a filed ticket on its task, through core (exit 3: it
                                                  already had one — close the duplicate ticket)
  handoff-sync                                    finished tickets back to their tasks: Live -> done; Live with
                                                  wont-do or deferred -> todo, unticked, with a note

Statuses (matched case-insensitively): ${STAGE_ORDER.join(' / ')}.
Two are Dane's and only \`ask\` may set them: ${OPERATOR_STATUSES.map((s) => DISPLAY[s]).join(', ')}.
`);
  process.exit(code);
}

// ── Readers ──────────────────────────────────────────────────────────────────
async function fetchAllTasks(list, { includeClosed = false } = {}) {
  const tasks = [];
  const closed = includeClosed ? '&include_closed=true' : '';
  for (let page = 0; page < 50; page += 1) {
    const out = await call('GET', `/api/v2/list/${list}/task?archived=false${closed}&page=${page}`);
    if (!out.res.ok) die('list tasks', out);
    if (!out.json || !Array.isArray(out.json.tasks)) die('list tasks (the response body was not the expected JSON)', out);
    tasks.push(...out.json.tasks);
    if (out.json.last_page !== false || out.json.tasks.length === 0) return tasks;
  }
  console.error('Stopped after 50 pages — treat this output as INCOMPLETE.');
  return tasks;
}

async function readTask(task) {
  const out = await call('GET', `/api/v2/task/${task}?include_markdown_description=true`);
  if (!out.res.ok) die('read the task', out);
  return out.json;
}

async function readComments(task) {
  const out = await call('GET', `/api/v2/task/${task}/comment`);
  if (!out.res.ok) die('read comments', out);
  if (!commentsReadable(out.json)) die('read comments (no comment list in the body)', out);
  return out.json.comments;
}

function assigneeNames(t) {
  return (t.assignees || []).map((a) => `${a.username} (${a.id})`).join(', ') || '(nobody)';
}

function clock(ms) {
  return new Date(Number(ms)).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function gh(args, { cwd } = {}) {
  const out = spawnSync('gh', args, { encoding: 'utf8', cwd });
  return { ok: out.status === 0, stdout: String(out.stdout || ''), stderr: String(out.stderr || '') };
}

// ── Guards shared by `status` and `ask` ──────────────────────────────────────
/** A ticket may not reach Ready to launch without a passing review on it. */
async function readyToLaunchRefused(task, status) {
  if (!isReadyToLaunch(status)) return false;
  if (flag('operator-asked')) {
    console.error('Review gate bypassed on your say-so (--operator-asked). Recorded in this transcript.');
    return false;
  }
  const gate = readyToLaunchGate(await readComments(task));
  if (gate.ok) return false;
  console.error(`\n"Ready to launch" is Dane's safe-to-merge signal, and ${gate.why}.`);
  console.error('Nothing was moved. If review really did pass, record the verdict first:');
  console.error(`  npm run clickup -- verdict --task ${task} --pass --if-status "In review" --body-file -\n`);
  return true;
}

/** Dane must not be asked for something he has already answered. */
async function alreadyAnsweredRefused(task, status) {
  if (!isOperatorStatus(status)) return null;
  if (flag('after-his-answer')) {
    console.error('Handing this back although he spoke last (--after-his-answer). Recorded in this transcript.');
    return null;
  }
  const comments = await readComments(task);
  if (operatorSpokeLast(comments, OPERATOR_ID)) {
    console.error(`\nREFUSED — Dane's own comment is the NEWEST one on ${task}, so a machine owes the next move.`);
    console.error('Handing it back now asks him to answer twice. Read what he said:');
    console.error(`  npm run clickup -- waiting --task ${task}`);
    console.error('If this really is a NEW question, say so on the record: ... --after-his-answer');
    console.error('Nothing was posted and the status has NOT moved.');
    return 2;
  }
  return null;
}

async function postComment(task, body) {
  const out = await call('POST', `/api/v2/task/${task}/comment`, body);
  if (!out.res.ok) die('post comment', out);
  const id = String(out.json?.id ?? '');
  const stored = (await readComments(task)).find((c) => String(c.id) === id);
  if (!stored || !(stored.comment_text || '').trim()) {
    console.error(`Comment did NOT land intact: id ${id || '(none)'} ${stored ? 'saved empty' : 'not found on the task'}.`);
    process.exit(1);
  }
  return { id, stored };
}

// ── Commands ─────────────────────────────────────────────────────────────────
if (!TOKEN) {
  console.error('CLICKUP_API_TOKEN is not set in this environment.\n');
  console.error('The sanctioned route is Doppler, which holds the token:  npm run clickup -- <command> ...');
  console.error('(package.json wraps this script in `doppler run --project wavecenter --config dev`.)');
  process.exit(2);
}

let cmd = process.argv[2];
if (!cmd || cmd === 'help' || cmd === '--help') usage(0);

if (cmd === 'claim') {
  const task = arg('task');
  if (!task) usage();
  const seen = await readTask(task);
  const now = seen.status?.status ?? '';
  if (!isClaimableByBuild(now)) {
    console.error(`NOT claimed: "${task}" is "${now || '?'}", which loop-build may not claim.`);
    console.error(`Claimable statuses, in drain order: ${CLAIMABLE_BY_BUILD.map((x) => DISPLAY[x]).join(', ')}. Take the next task.`);
    process.exit(3);
  }
  process.argv = [...process.argv.slice(0, 2), 'status', ...process.argv.slice(3), '--status', DISPLAY[BUILDING], '--if-status', now];
  console.error(`claiming ${task} out of "${now}" (guarded on that exact status)`);
  cmd = 'status';
}

if (cmd === 'whoami') {
  const out = await call('GET', '/api/v2/user');
  if (!out.res.ok) die('whoami', out);
  console.log(`Token valid. Acting as: ${out.json.user.username} <${out.json.user.email}> (id ${out.json.user.id})`);
  if (Number(out.json.user.id) === OPERATOR_ID) console.error("  (This is Dane's own seat, as on StarCaster. Every comment this script posts carries the [machine] marker so readers can tell.)");
  reportLimits();

} else if (cmd === 'lists') {
  const space = arg('space') || SPACE;
  const [folderless, folders] = await Promise.all([
    call('GET', `/api/v2/space/${space}/list?archived=false`),
    call('GET', `/api/v2/space/${space}/folder?archived=false`),
  ]);
  if (!folderless.res.ok || !folderless.json) die('list folderless lists', folderless);
  if (!folders.res.ok || !folders.json) die('list folders', folders);
  for (const l of folderless.json.lists) console.log(`${l.id}\t${l.name}`);
  for (const f of folders.json.folders) for (const l of f.lists || []) console.log(`${l.id}\t${f.name} / ${l.name}`);
  reportLimits();

} else if (cmd === 'queue') {
  const list = arg('list') || LOOP_QUEUE_LIST;
  const status = arg('status');
  const claimable = flag('claimable');
  if (claimable && status) {
    console.error('--claimable and --status are two different questions; pass one.');
    process.exit(2);
  }
  const tasks = await fetchAllTasks(list);
  let wanted;
  if (claimable) {
    const owed = [];
    for (const t of tasks.filter((x) => isReadyToLaunch(statusOf(x)))) {
      if (conflictToSettle({ status: t.status?.status, comments: await readComments(t.id), operatorId: OPERATOR_ID }).ok) owed.push(t.id);
    }
    wanted = buildOrder(tasks, owed);
  } else {
    wanted = status ? tasks.filter((t) => (t.status?.status ?? '').toLowerCase() === status.toLowerCase()) : tasks.slice();
    wanted.sort(compareWithinStatus);
  }
  for (const t of wanted) {
    const created = new Date(Number(t.date_created)).toISOString().slice(0, 10);
    console.log([t.id, t.status?.status ?? '?', t.priority?.priority ?? 'none', created, t.name].join('\t'));
  }
  const scope = claimable ? ' claimable by loop-build (rework, then ready to launch with a conflict to settle, then queued)' : (status ? ` with status "${status}"` : '');
  console.error(`${wanted.length} task(s)${scope} in list ${list} (first line is the one to take)`);
  if (claimable && wanted.length) {
    if (isReadyToLaunch(statusOf(wanted[0]))) console.error(`  settle its conflict (never claim it, never move it): npm run clickup -- settle --task ${wanted[0].id}`);
    else console.error(`  claim it: npm run clickup -- claim --task ${wanted[0].id}`);
  }
  reportLimits();

} else if (cmd === 'get') {
  const task = arg('task');
  if (!task) usage();
  const t = await readTask(task);
  const comments = await readComments(task);
  const pr = findPullRequest(comments);
  console.log(`id:       ${t.id}`);
  console.log(`name:     ${t.name}`);
  console.log(`status:   ${t.status?.status ?? '?'}`);
  console.log(`priority: ${t.priority?.priority ?? 'none'}`);
  console.log(`assigned: ${assigneeNames(t)}`);
  console.log(`tags:     ${(t.tags || []).map((x) => x.name).join(', ') || '(none)'}`);
  console.log(`list:     ${t.list?.name} (${t.list?.id})`);
  console.log(`pr:       ${pr ? pr.url : '(none recorded)'}`);
  console.log(`rounds:   ${sendBackRounds(comments)} send-back(s) so far`);
  console.log(`url:      ${t.url}`);
  console.log('---');
  console.log(t.markdown_description || t.description || '(no body)');
  reportLimits();

} else if (cmd === 'task-name') {
  const task = arg('task');
  if (!task) usage();
  const t = await readTask(task);
  const name = String(t.name ?? '');
  if (!name.trim()) { console.error(`Task ${task} has an empty name.`); process.exit(1); }
  process.stdout.write(`${name}\n`);

} else if (cmd === 'comments') {
  const task = arg('task');
  if (!task) usage();
  const comments = newestFirst(await readComments(task)).reverse();
  for (const c of comments) {
    const who = isMachineComment(c.comment_text) ? `${c.user?.username ?? '?'} [machine]` : (c.user?.username ?? '?');
    console.log(`[${clock(c.date)} MT] ${who} (${c.user?.id ?? '?'}, comment ${c.id}):`);
    console.log(stripMachineMarker(c.comment_text) || '(empty)');
    console.log('---');
  }
  console.error(`${comments.length} comment(s) on task ${task}`);
  reportLimits();

} else if (cmd === 'waiting') {
  const task = arg('task');
  const tasks = task ? [await readTask(task)] : (await fetchAllTasks(LOOP_QUEUE_LIST)).filter((t) => isOperatorStatus(t.status?.status));
  let his = 0;
  for (const t of tasks) {
    const comments = await readComments(t.id);
    const newest = newestFirst(comments)[0];
    const assigned = (t.assignees || []).some((a) => a.id === OPERATOR_ID);
    const status = t.status?.status ?? '?';
    let verdict;
    if (!isOperatorStatus(status)) verdict = `NOT HIS — status "${status}" is a machine status`;
    else if (operatorSpokeLast(comments, OPERATOR_ID)) verdict = 'ANSWERED — his comment is the newest; a machine owes the next move';
    else { verdict = `WAITING ON DANE — "${status}"${assigned ? '' : ' (but he is NOT assigned — fix the handoff)'}`; his += 1; }
    const lastWord = newest ? `${isMachineComment(newest.comment_text) ? 'a loop' : (newest.user?.username ?? '?')} ${clock(newest.date)} MT` : '(no comments)';
    console.log(`${t.id}\t${status}\tassigned: ${assigned ? 'Dane' : 'not Dane'}\tlast word: ${lastWord}\t${verdict}\t${t.name}`);
  }
  console.error(`${his} ticket(s) actually waiting on Dane${task ? '' : ` in list ${LOOP_QUEUE_LIST}`}.`);
  process.exit(his ? 3 : 0);

} else if (cmd === 'task') {
  const list = arg('list') || LOOP_QUEUE_LIST;
  const name = arg('name');
  const bodyFile = arg('body-file');
  if (!name || !bodyFile) usage();
  if (String(arg('priority', '')).toLowerCase() === 'urgent' && !flag('operator-asked')) {
    console.error('\nUrgent is reserved for Dane, not something an agent sets on its own. File at High or below.');
    console.error('If he explicitly asked for Urgent, add --operator-asked — your written claim, visible in the transcript.\n');
    process.exit(1);
  }
  const body = readBody(bodyFile);
  const quoted = findBlockquoteLines(body);
  if (quoted.length) {
    console.error(`The body has "> " blockquote lines (${quoted.join(', ')}). ClickUp DELETES them silently. Use a fenced block. Nothing was created.`);
    process.exit(2);
  }
  const tags = arg('tags') ? arg('tags').split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const out = await call('POST', `/api/v2/list/${list}/task`, {
    name,
    markdown_description: body,
    status: arg('status') || undefined,
    priority: PRIORITY[String(arg('priority', '')).toLowerCase()] || undefined,
    tags,
  });
  if (!out.res.ok) die('create task', out);
  const id = out.json.id;
  if (arg('id-out')) writeFileSync(arg('id-out'), id);
  console.log(`\nCreated task ${id}\n  ${out.json.url}`);
  const t = await readTask(id);
  const chars = (t.description || '').length;
  console.log('\nVerified by reading the task back:');
  console.log(`  name:        ${t.name}`);
  console.log(`  list:        ${t.list?.name} (${t.list?.id})`);
  console.log(`  status:      ${t.status?.status}`);
  console.log(`  priority:    ${t.priority?.priority ?? '(none)'}`);
  console.log(`  tags:        ${(t.tags || []).map((x) => x.name).join(', ') || '(none)'}`);
  console.log(`  description: ${chars} characters`);
  if (tags && tags.length) {
    const landed = new Set((t.tags || []).map((x) => String(x.name || '').toLowerCase()));
    const missing = tags.filter((w) => !landed.has(w.toLowerCase()));
    if (missing.length) { console.error(`\n  TAGS DID NOT STICK: [${missing.join(', ')}]`); process.exit(1); }
  }
  if (chars === 0) { console.error('\n  BODY IS EMPTY — the description did not save. The task exists but is a shell.'); process.exit(1); }
  if (arg('status') && String(t.status?.status).toLowerCase() !== String(arg('status')).toLowerCase()) {
    console.error(`\n  STATUS DID NOT STICK: asked "${arg('status')}", got "${t.status?.status}". The list may not have that status yet (docs/CLICKUP_SETUP.md).`);
    process.exit(1);
  }
  reportLimits();

} else if (cmd === 'describe') {
  const task = arg('task'), bodyFile = arg('body-file');
  if (!task || !bodyFile) usage();
  const body = readBody(bodyFile);
  if (!body.trim()) { console.error('Refusing to replace the description with an empty body.'); process.exit(2); }
  const quoted = findBlockquoteLines(body);
  if (quoted.length) { console.error(`The body has "> " blockquote lines (${quoted.join(', ')}). ClickUp DELETES them. Nothing was written.`); process.exit(2); }
  const out = await call('PUT', `/api/v2/task/${task}`, { markdown_description: body });
  if (!out.res.ok) die('replace description', out);
  const t = await readTask(task);
  const chars = (t.description || '').length;
  if (chars === 0) { console.error('The description came back EMPTY after the write.'); process.exit(1); }
  console.log(`Task ${task}: description replaced (${chars} characters, read back).`);
  reportLimits();

} else if (cmd === 'comment') {
  const task = arg('task'), bodyFile = arg('body-file');
  if (!task || !bodyFile) usage();
  const sent = readBody(bodyFile);
  const quoted = findBlockquoteLines(sent);
  if (quoted.length) { console.error(`The comment has "> " blockquote lines (${quoted.join(', ')}). ClickUp DELETES them. Nothing was posted.`); process.exit(2); }
  const { id, stored } = await postComment(task, { comment_text: sent });
  console.log(`Comment ${id} added to task ${task} (${stored.comment_text.length} characters, verified by reading it back).`);
  reportLimits();

} else if (cmd === 'status') {
  const task = arg('task'), status = arg('status');
  if (!task || !status) usage();
  const assignId = arg('assign') ? Number(arg('assign')) : null;
  if (assignId !== null && !Number.isInteger(assignId)) { console.error('--assign needs a numeric ClickUp user id.'); process.exit(2); }
  if (assignId === MACHINE_ID) { console.error('Refusing to assign the machine account (Pulse). Handoffs go to Dane.'); process.exit(2); }
  if (isOperatorStatus(status) && !flag('no-card')) {
    console.error(`\n"${status}" is a handoff to Dane, not just a status. Use \`ask\`, which posts the operator card and moves the status together:`);
    console.error(`  npm run clickup -- ask --task ${task} --status "${status}" --body-file -\n`);
    console.error(`The card: @@ASKED (his words, verbatim) / @@WHEN (optional) / @@CONTEXT (${CONTEXT_MIN_WORDS}-${CONTEXT_MAX_WORDS} words) / @@NEEDED (the ask) / @@EVIDENCE (costly asks only).`);
    console.error('If this really is a status move with no ask attached, pass --no-card — your written claim that a card is not owed.\n');
    process.exit(2);
  }
  if (await readyToLaunchRefused(task, status)) process.exit(2);
  const answered = await alreadyAnsweredRefused(task, status);
  if (answered !== null) process.exit(answered);

  const before = await readTask(task);
  const was = before.status?.status ?? '?';
  const ifStatus = arg('if-status');
  if (ifStatus && was.toLowerCase() !== ifStatus.toLowerCase()) {
    console.error(`NOT moved: expected status "${ifStatus}" but the task is "${was}" — another loop or Dane got there first. Take the next task.`);
    process.exit(3);
  }
  const toOperator = isOperatorStatus(status);
  let add = assignId !== null ? [assignId] : [];
  let clearing = flag('clear-assignees');
  if (!flag('no-auto-assign')) {
    if (toOperator && add.length === 0) add = [OPERATOR_ID];
    if (!toOperator && !clearing && add.length === 0) clearing = true;
  }
  const rem = clearing ? (before.assignees || []).map((a) => a.id).filter((id) => !add.includes(id)) : [];
  const body = { status };
  if (add.length || rem.length) body.assignees = { add, rem };
  const out = await call('PUT', `/api/v2/task/${task}`, body);
  if (!out.res.ok) die('set status', out);
  const t = out.json;
  const now = t.status?.status ?? '?';
  if (now.toLowerCase() !== status.toLowerCase()) {
    console.error(`Status did NOT stick: asked for "${status}", the write came back "${now}".`);
    console.error('Usually the list does not have that status — statuses are per-list in ClickUp (docs/CLICKUP_SETUP.md).');
    process.exit(1);
  }
  const finalIds = (t.assignees || []).map((a) => a.id);
  for (const id of add) if (!finalIds.includes(id)) { console.error(`Assignee did NOT stick: asked to assign ${id}, the task carries [${finalIds.join(', ')}].`); process.exit(1); }
  if (clearing && finalIds.some((id) => !add.includes(id))) { console.error(`Assignees did NOT clear: [${finalIds.join(', ')}] still on the task.`); process.exit(1); }
  console.log(`Task ${task}: "${was}" -> "${now}", assigned: ${assigneeNames(t)} (verified from the write response).`);
  reportLimits();

} else if (cmd === 'priority') {
  const task = arg('task'), wanted = String(arg('priority', '')).toLowerCase();
  if (!task || !(wanted in PRIORITY)) usage();
  if (wanted === 'urgent' && !flag('operator-asked')) { console.error('Urgent is reserved for Dane. Add --operator-asked only if he explicitly asked.'); process.exit(1); }
  const before = await readTask(task);
  const out = await call('PUT', `/api/v2/task/${task}`, { priority: PRIORITY[wanted] });
  if (!out.res.ok) die('set priority', out);
  const now = out.json.priority?.priority ?? '(none)';
  if (now !== wanted) { console.error(`Priority did NOT stick: asked "${wanted}", got "${now}".`); process.exit(1); }
  console.log(`Task ${task}: priority "${before.priority?.priority ?? '(none)'}" -> "${now}".`);
  reportLimits();

} else if (cmd === 'tag') {
  const task = arg('task'), add = arg('add'), remove = arg('remove');
  if (!task || (!add && !remove) || (add && remove)) usage();
  const name = encodeURIComponent(add || remove);
  const out = await call(add ? 'POST' : 'DELETE', `/api/v2/task/${task}/tag/${name}`);
  if (!out.res.ok) die(add ? 'add tag' : 'remove tag', out);
  const t = await readTask(task);
  const has = (t.tags || []).some((x) => String(x.name).toLowerCase() === String(add || remove).toLowerCase());
  if (add && !has) { console.error(`Tag "${add}" did NOT stick.`); process.exit(1); }
  if (remove && has) { console.error(`Tag "${remove}" is still on the task.`); process.exit(1); }
  console.log(`Task ${task}: tags now [${(t.tags || []).map((x) => x.name).join(', ')}].`);
  reportLimits();

} else if (cmd === 'pr-opened') {
  const task = arg('task'), prArg = arg('pr');
  if (!task || !prArg) usage();
  const m = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(prArg.trim());
  let repo = arg('repo'), prNumber;
  if (m) { repo = repo || `${m[1]}/${m[2]}`; prNumber = Number(m[3]); } else if (/^\d+$/.test(prArg.trim())) {
    if (!repo) { console.error('--pr got a bare number, so --repo owner/name is needed.'); process.exit(2); }
    prNumber = Number(prArg.trim());
  } else { console.error(`--pr got "${prArg}", which is neither a GitHub pull-request URL nor a number.`); process.exit(2); }
  const prUrl = `https://github.com/${repo}/pull/${prNumber}`;
  const view = gh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'body,url']);
  if (!view.ok) { console.error(`Could not read PR #${prNumber} from ${repo}: ${view.stderr.slice(0, 300)}\nNothing was written.`); process.exit(1); }
  let prJson;
  try { prJson = JSON.parse(view.stdout); } catch { console.error('gh returned non-JSON. Nothing was written.'); process.exit(1); }
  if (!bodyNamesTicket(prJson.body, task)) {
    console.error(`\nPR #${prNumber} has no link back to this ticket in its body, so nothing was written.`);
    console.error(`Add this line to the PR body and run again:\n  ClickUp: https://app.clickup.com/t/${task}\n`);
    process.exit(4);
  }
  let already = false;
  if (flag('if-missing') && prTrailLanded(await readComments(task), prNumber).ok) {
    already = true;
    console.log(`Task ${task}: PR #${prNumber} is already recorded — nothing written.`);
  }
  if (!already) {
    const text = prOpenedComment(prUrl, arg('body-file') ? readBody(arg('body-file')) : '');
    await postComment(task, { comment_text: text });
    const landed = prTrailLanded(await readComments(task), prNumber);
    if (!landed.ok) { console.error(`\nThe "PR opened" trail did NOT land: ${landed.why}. Fix the comment by hand before handing this to review.\n`); process.exit(1); }
    console.log(`Task ${task}: PR #${prNumber} recorded (${prUrl}), read back and parsed by the gate's own reader.`);
  }
  reportLimits();

} else if (cmd === 'verdict') {
  const task = arg('task');
  const passed = flag('pass'), failed = flag('fail');
  if (!task || passed === failed) { console.error('verdict needs --task <id> and exactly one of --pass or --fail.'); process.exit(2); }
  const ifStatus = arg('if-status');
  if (!ifStatus && !flag('no-guard')) {
    console.error('\nverdict needs --if-status "<the status you claimed>" — normally --if-status "In review".');
    console.error('It refuses to write if the ticket moved while you were reviewing. Pass --no-guard only as a written claim.\n');
    process.exit(2);
  }
  if (ifStatus) {
    const was = (await readTask(task)).status?.status ?? '?';
    if (was.toLowerCase() !== ifStatus.toLowerCase()) {
      console.error(`\nNOTHING WRITTEN: expected "${ifStatus}", the ticket is now "${was}". It moved while you were reviewing.`);
      console.error(`Stand down: re-read with \`comments --task ${task}\` and \`get --task ${task}\`, then take the next task.\n`);
      process.exit(3);
    }
  }
  const note = arg('body-file') ? readBody(arg('body-file')).trim() : '';
  if (!passed) {
    const history = await readComments(task);
    const round = nextRound(history);
    if (wouldEscalate(history) && !flag('fourth-round-anyway')) {
      console.error(`\nNOTHING WRITTEN: this would be send-back round ${round}, and the loop escalates at ${ESCALATE_AT_ROUND}.`);
      console.error('Three rounds means the spec is wrong, not the build. Ask Dane instead:');
      for (const line of roundSummaryLines(history)) console.error(`  ${line}`);
      console.error(`\n  npm run clickup -- ask --task ${task} --status "Needs your input" --body-file -`);
      console.error('Offer him named options (respec / split / drop). --fourth-round-anyway overrides, on the record.\n');
      process.exit(3);
    }
    if (!note) { console.error('\nNOTHING WRITTEN: a send-back needs a reason (--body-file -). Its first line is what the board shows.\n'); process.exit(2); }
  }
  const { id } = await postComment(task, { comment_text: verdictComment(passed, note) });
  const after = await readComments(task);
  const gate = readyToLaunchGate(after);
  if (passed && !gate.ok) { console.error(`\nThe PASS verdict posted but does NOT read back as a pass: ${gate.why}.\n`); process.exit(1); }
  if (!passed && gate.ok) { console.error('\nA send-back posted, but the newest verdict still reads as a PASS. Check the ticket by eye.\n'); process.exit(1); }
  const rounds = sendBackRounds(after);
  console.log(`Task ${task}: verdict ${passed ? 'PASSED' : `sent back (round ${rounds})`} recorded as comment ${id}, verified through the Ready-to-launch gate itself.`);
  if (!passed) {
    console.log(`Next: npm run clickup -- status --task ${task} --status Rework --if-status "In review"`);
    if (rounds + 1 >= ESCALATE_AT_ROUND) console.log(`NOTE: a further send-back would be round ${rounds + 1} — the loop escalates to Dane at ${ESCALATE_AT_ROUND}.`);
  }
  reportLimits();

} else if (cmd === 'ask') {
  const task = arg('task'), bodyFile = arg('body-file');
  if (!task || !bodyFile) usage();
  const noMove = flag('no-move');
  const status = arg('status') || DISPLAY['needs your input'];
  if (!noMove && !isOperatorStatus(status)) {
    console.error(`\`ask\` hands work to Dane, so --status must be one of: ${OPERATOR_STATUSES.map((s) => DISPLAY[s]).join(', ')}. For a machine status use \`status\`.`);
    process.exit(2);
  }
  if (!noMove && await readyToLaunchRefused(task, status)) process.exit(2);
  let card, commentBody;
  try { ({ card, comment: commentBody } = buildCard(readBody(bodyFile))); } catch (err) { console.error(`\n${err.message}\n`); process.exit(2); }
  if (!noMove) { const stop = await alreadyAnsweredRefused(task, status); if (stop !== null) process.exit(stop); }
  const { id: cardId, stored } = await postComment(task, { comment: commentBody });
  const lost = cardSurvived(card, stored.comment_text);
  if (lost) { console.error(`\n${lost}\nComment ${cardId} is on the task. The status has NOT been moved.`); process.exit(1); }
  if (noMove) { console.log(`Task ${task}: card ${cardId} posted (status untouched, --no-move).`); reportLimits(); process.exit(0); }
  const was = (await readTask(task)).status?.status ?? '?';
  const moved = await call('PUT', `/api/v2/task/${task}`, { status, assignees: { add: [OPERATOR_ID], rem: [] } });
  if (!moved.res.ok) { console.error(`The card posted (comment ${cardId}) but the status did NOT move.`); die('set status', moved); }
  const now = moved.json.status?.status ?? '?';
  if (now.toLowerCase() !== status.toLowerCase()) { console.error(`Card posted (comment ${cardId}), but the status did NOT stick: asked "${status}", got "${now}".`); process.exit(1); }
  if (!(moved.json.assignees || []).some((a) => a.id === OPERATOR_ID)) { console.error(`Card posted and status moved to "${now}", but Dane is NOT assigned — the handoff is incomplete.`); process.exit(1); }
  console.log(`Task ${task}: card ${cardId} posted, "${was}" -> "${now}", assigned: ${assigneeNames(moved.json)}.`);
  reportLimits();

} else if (cmd === 'settle' || cmd === 'settled' || cmd === 'settle-blocked') {
  // A Ready to launch ticket whose approved PR conflicts with main. The build
  // loop works it IN PLACE: no claim, no status change (Ready to launch is
  // Dane's), because his "merge" still stands and the merge lane carries it
  // out once the combined code passes verify.
  //   settle          read-only: is it owed a fix, and which PR (exit 0 yes, 3 no)
  //   settled         record the fix; refuses unless GitHub reads the PR MERGEABLE
  //   settle-blocked  the two sides need a real choice: ask Dane with a card
  const task = arg('task');
  if (!task) usage();
  const t = await readTask(task);
  const comments = await readComments(task);
  const owed = conflictToSettle({ status: t.status?.status, comments, operatorId: OPERATOR_ID });
  if (!owed.ok) { console.error(`NOT owed a conflict fix: ${task} — ${owed.why}. Take the next task.`); process.exit(3); }
  const pr = findPullRequest(comments);
  if (!pr) { console.error(`${task} has no "PR opened:" line, so there is no branch to settle. Take the next task.`); process.exit(3); }
  const repo = `${pr.owner}/${pr.repo}`;
  const head = { authorizationId: owed.authorizationId, code: owed.code };

  if (cmd === 'settle') {
    const view = gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'headRefName', '--jq', '.headRefName'], { cwd: tmpdir() });
    if (!view.ok) { console.error(`Could not read PR #${pr.number} from GitHub: ${view.stderr.trim().slice(0, 300)}`); process.exit(1); }
    console.log(`task:    ${t.id}  (status stays "${t.status?.status}" — do not claim or move it)`);
    console.log(`name:    ${t.name}`);
    console.log(`reason:  ${owed.code}  (Dane's "merge" is comment ${owed.authorizationId})`);
    console.log(`pr:      ${pr.url}`);
    console.log(`branch:  ${view.stdout.trim()}`);
    console.error('\nMerge origin/main into that branch, keep both sides, run `npm run verify`, push (never force), then:');
    console.error(`  npm run clickup -- settled --task ${t.id} --body-file -          what conflicted and how both sides were kept`);
    console.error(`  npm run clickup -- settle-blocked --task ${t.id} --body-file -   if it needs his choice (an operator card)`);
    reportLimits();
    process.exit(0);
  }

  if (cmd === 'settled') {
    const body = readBody(arg('body-file') || usage()).trim();
    if (!body) { console.error('Say what conflicted and how both sides were kept. Nothing was posted.'); process.exit(2); }
    // GitHub works mergeability out after a push; give it a minute. Right
    // after a push it can still report the old CONFLICTING, so only believe
    // CONFLICTING once it has held for a few readings.
    let mergeable = 'UNKNOWN';
    let conflicting = 0;
    for (let i = 0; i < 12; i += 1) {
      const out = gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'mergeable', '--jq', '.mergeable'], { cwd: tmpdir() });
      mergeable = out.ok ? out.stdout.trim() : 'UNREADABLE';
      if (mergeable === 'MERGEABLE') break;
      conflicting = mergeable === 'CONFLICTING' ? conflicting + 1 : 0;
      if (conflicting >= 4) break;
      await sleep(5000);
    }
    if (mergeable !== 'MERGEABLE') {
      console.error(`PR #${pr.number} reads "${mergeable}", not MERGEABLE, so the conflict is not settled. Nothing was posted.`);
      process.exit(1);
    }
    const { id } = await postComment(task, { comment_text: `${settledLine(head)}\n\n${body}\n\nThe status stays Ready to launch and your "merge" still stands: the merge lane merges PR #${pr.number} once \`verify\` is green on the combined code.` });
    console.log(`Task ${task}: settled note ${id} posted; PR #${pr.number} reads MERGEABLE; status untouched ("${t.status?.status}").`);
    reportLimits();
    process.exit(0);
  }

  let commentBody, card;
  try { ({ card, comment: commentBody } = buildCard(readBody(arg('body-file') || usage()))); } catch (err) { console.error(`\n${err.message}\n`); process.exit(2); }
  const unanswerable = settleCardProblem(card.needed);
  if (unanswerable) { console.error(`\n${unanswerable}\n\nNothing was posted and Dane was not assigned.\n`); process.exit(2); }
  const { id: cardId, stored } = await postComment(task, { comment: [{ text: `${notSettledLine(head)}\n\n` }, ...commentBody] });
  const lost = cardSurvived(card, stored.comment_text);
  if (lost) { console.error(`\n${lost}\nComment ${cardId} is on the task.`); process.exit(1); }
  const moved = await call('PUT', `/api/v2/task/${task}`, { assignees: { add: [OPERATOR_ID], rem: [] } });
  if (!moved.res.ok) { console.error(`Card ${cardId} posted, but Dane could NOT be assigned.`); die('assign Dane', moved); }
  console.log(`Task ${task}: card ${cardId} posted, Dane assigned, status untouched ("${t.status?.status}"). The build loop will not pick it again for this "merge".`);
  reportLimits();

} else if (cmd === 'merge-on-comment') {
  // THE MERGE LANE. Dane's decision, 2026-10-11: "On the StarCaster loop
  // queue I simply say 'merge' on any given Ready to launch ticket. I'd like
  // to be consistent." launchd runs this every 10 minutes on the Mac Mini
  // (scripts/install_loop_runner.sh). It is plain node, no Claude session.
  //
  // The guards, in order: the ticket is in Ready to launch (only a passed
  // review puts it there); his NEWEST own comment, unstamped, is a whole
  // merge phrase and is newer than the PASS verdict; the PR is open,
  // mergeable, caught up with main and its `verify` check green. `Live` is
  // set only after GitHub is read back saying MERGED.
  //
  // gh runs from a temp folder with --repo, so it never touches a local
  // checkout: --delete-branch deletes the branch on GitHub only, and never
  // tries to switch or delete a branch a worktree has checked out.
  const dry = flag('dry-run');
  const outside = tmpdir();
  const log = (line) => console.log(`[${clock(Date.now())} MT] ${line}`);
  const ghJson = (args) => {
    const out = gh(args, { cwd: outside });
    if (!out.ok) return { error: out.stderr.trim().slice(0, 300) || 'gh failed with no message' };
    try { return { value: JSON.parse(out.stdout) }; } catch { return { error: 'gh returned something that is not JSON' }; }
  };
  const write = async (label, fn) => {
    if (dry) { log(`  (dry run) would ${label}`); return true; }
    return fn();
  };
  /** Post a comment; on failure say so and return false (never exit mid-pass). */
  const note = (task, text) => write(`comment on ${task}: ${text.split('\n')[0]}`, async () => {
    const out = await call('POST', `/api/v2/task/${task}/comment`, { comment_text: text });
    if (!out.res.ok) { log(`  COMMENT FAILED on ${task}: HTTP ${out.res.status}`); return false; }
    return true;
  });
  /** Move to a machine (or terminal) status, clearing assignees, and read it back. */
  const moveTo = (t, status) => write(`move ${t.id} to ${status}`, async () => {
    const rem = (t.assignees || []).map((a) => a.id);
    const out = await call('PUT', `/api/v2/task/${t.id}`, { status, ...(rem.length ? { assignees: { add: [], rem } } : {}) });
    const now = out.json?.status?.status ?? '?';
    if (!out.res.ok || now.toLowerCase() !== status.toLowerCase()) {
      log(`  STATUS DID NOT STICK on ${t.id}: asked "${status}", got "${now}" (HTTP ${out.res.status})`);
      return false;
    }
    log(`  ${t.id}: "${t.status?.status}" -> "${now}" (read back from the write)`);
    return true;
  });
  const refuse = async (t, comments, authorizationId, code, why, todo) => {
    log(`  NOT MERGED ${t.id} (${code}): ${why}`);
    if (alreadyNoticed(comments, authorizationId, code)) { log('  (Dane was already told this; not repeating it)'); return; }
    await note(t.id, refusalNotice({ authorizationId, code, why, todo }));
  };

  const tasks = await fetchAllTasks(LOOP_QUEUE_LIST);
  const ready = tasks.filter((t) => statusOf(t) === READY_TO_LAUNCH);
  const asking = tasks.filter((t) => statusOf(t) === NEEDS_YOUR_INPUT);
  log(`merge lane${dry ? ' (DRY RUN — nothing is written)' : ''}: ${ready.length} Ready to launch, ${asking.length} Needs your input`);
  let merged = 0, requeued = 0;

  for (const t of ready) {
    const comments = await readComments(t.id);
    const auth = findAuthorization({ status: t.status?.status, comments, operatorId: OPERATOR_ID });
    if (!auth.ok) {
      if (auth.code) await refuse(t, comments, auth.comment.id, auth.code, auth.why, auth.todo);
      else log(`  ${t.id}: waiting for Dane (${auth.why}) — ${t.name}`);
      continue;
    }
    const authId = String(auth.comment.id);
    log(`  ${t.id}: Dane wrote "${stripMachineMarker(auth.comment.comment_text).trim()}" (comment ${authId}) — ${t.name}`);
    const pr = findPullRequest(comments);
    if (!pr) {
      await refuse(t, comments, authId, 'no-pr', 'this ticket has no "PR opened:" line, so there is no pull request to merge.',
        'A session must record the PR with `npm run clickup -- pr-opened`.');
      continue;
    }
    const repo = `${pr.owner}/${pr.repo}`;
    const viewArgs = ['pr', 'view', String(pr.number), '--repo', repo, '--json', 'number,state,mergeable,statusCheckRollup,headRefName,headRefOid,baseRefName,mergeCommit,url'];
    const view = ghJson(viewArgs);
    if (view.error) { log(`  could not read PR #${pr.number} from GitHub (${view.error}) — trying again next pass`); continue; }
    const p = view.value;
    let behindBy = 0;
    if (p.state === 'OPEN') {
      const cmp = gh(['api', `repos/${repo}/compare/${p.baseRefName}...${p.headRefOid}`, '--jq', '.behind_by'], { cwd: outside });
      if (!cmp.ok || !/^\d+$/.test(cmp.stdout.trim())) { log(`  could not tell how far PR #${p.number} is behind ${p.baseRefName} — trying again next pass`); continue; }
      behindBy = Number(cmp.stdout.trim());
    }
    const decision = prDecision(p, { behindBy });

    if (decision.act === 'wait') { log(`  waiting: ${decision.why}`); continue; }
    if (decision.act === 'refuse') { await refuse(t, comments, authId, decision.code, decision.why, decision.todo); continue; }
    if (decision.act === 'update-branch') {
      log(`  PR #${p.number} is ${behindBy} commit(s) behind ${p.baseRefName}: merging ${p.baseRefName} into it so verify runs on the combined code`);
      await write(`merge ${p.baseRefName} into ${p.headRefName}`, async () => {
        const up = gh(['api', '-X', 'PUT', `repos/${repo}/pulls/${p.number}/update-branch`, '-f', `expected_head_sha=${p.headRefOid}`], { cwd: outside });
        if (!up.ok) {
          await refuse(t, comments, authId, 'catch-up-failed', `PR #${p.number} is behind ${p.baseRefName}, and GitHub refused to merge ${p.baseRefName} into it (${up.stderr.trim().slice(0, 200)}).`,
            SETTLE_TODO);
          return false;
        }
        log('  caught up; verify runs again, and a later pass merges once it is green');
        return true;
      });
      continue;
    }

    let commit;
    if (decision.act === 'already-merged') {
      commit = p.mergeCommit?.oid;
      log(`  PR #${p.number} is already merged (${commit || 'commit unknown'}) — nothing left to merge`);
    } else {
      log(`  merging PR #${p.number} (squash, branch deleted)`);
      const ok = await write(`squash-merge PR #${p.number}`, async () => {
        const m = gh(['pr', 'merge', String(p.number), '--repo', repo, '--squash', '--delete-branch', '--match-head-commit', p.headRefOid], { cwd: outside });
        if (!m.ok) log(`  gh pr merge said: ${m.stderr.trim().slice(0, 300)}`);
        return true;
      });
      if (!ok || dry) continue;
      const back = ghJson(viewArgs);
      if (back.error || back.value.state !== 'MERGED') {
        // Never Live before MERGED is read back. Whatever went wrong, the next
        // pass re-reads GitHub and either merges or says why.
        log(`  PR #${p.number} does NOT read back as MERGED (${back.error || back.value.state}) — ticket left in Ready to launch`);
        continue;
      }
      commit = back.value.mergeCommit?.oid;
    }

    const short = String(commit || 'unknown').slice(0, 7);
    if (!mergeRecorded(comments, pr.url)) {
      const body = decision.act === 'already-merged'
        ? `Your "merge" (comment ${authId}) was read, but PR #${p.number} had already been merged outside this lane, as commit ${short}. Nothing was merged twice. Setting this ticket Live.`
        : `Merged on your word (comment ${authId}): PR #${p.number} squash-merged into ${p.baseRefName} as commit ${short}, with \`verify\` green, and the branch deleted. Setting this ticket Live.`;
      if (!await note(t.id, mergedComment({ prUrl: pr.url, commit: short, body }))) continue;
    }
    if (await moveTo(t, DISPLAY[LIVE])) merged += 1;
  }

  for (const t of asking) {
    const comments = await readComments(t.id);
    const answer = danesAnswer({ status: t.status?.status, comments, operatorId: OPERATOR_ID });
    if (!answer) { log(`  ${t.id}: still waiting on Dane — ${t.name}`); continue; }
    log(`  ${t.id}: Dane answered (comment ${answer.id}) — back to Queued — ${t.name}`);
    if (!await note(t.id, `Dane answered (comment ${answer.id}); back in the queue so the build loop reads his answer.`)) continue;
    if (await moveTo(t, DISPLAY[QUEUED])) requeued += 1;
  }

  log(`merge lane done: ${merged} merged and set Live, ${requeued} answered ticket(s) requeued${dry ? ' (dry run: counts are what WOULD happen)' : ''}`);
  reportLimits();

} else if (cmd === 'handoff-next' || cmd === 'handoff-record' || cmd === 'handoff-sync') {
  // THE HAND-OFF LANE's database side (.claude/skills/loop-handoff). The
  // service key comes from Doppler on the Mini and is never printed.
  let db;
  try {
    db = serviceDb({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
  } catch (err) { console.error(err.message); process.exit(1); }

  if (cmd === 'handoff-next') {
    let next;
    try { next = await nextHandOff(db); } catch (err) { console.error(`Could not read the ticked tasks: ${err.message}`); process.exit(1); }
    if (!next.task) { console.error(next.why); process.exit(3); }
    const t = next.task;
    console.log(JSON.stringify({
      id: t.id, title: t.title, notes: t.notes, priority: t.priority, ticketPriority: ticketPriorityOf(t),
      createdAt: t.createdAt, taskLine: taskLine(t.id), tag: FROM_WAVECENTER_TAG,
    }, null, 2));
    console.error(`${next.waiting} ticked task(s) waiting; this is the first in line.`);

  } else if (cmd === 'handoff-record') {
    const task = arg('task'), ticket = arg('ticket');
    if (!task || !ticket) usage();
    const out = await call('GET', `/api/v2/task/${encodeURIComponent(ticket)}?include_markdown_description=true`);
    if (!out.res.ok) die(`read ticket ${ticket} back (the task was NOT changed)`, out);
    try {
      const saved = await recordHandOff({ db, ticket: out.json, taskId: task, listId: LOOP_QUEUE_LIST, tool: LOOP_HANDOFF_TOOL });
      console.log(`Task ${task} "${saved.title}": now with AI agents, status ${saved.status}, ticket ${saved.agentTicketUrl}.`);
    } catch (err) {
      if (err instanceof CoreError && /already handed|another pass first/.test(err.message)) {
        console.error(`NOT recorded: ${err.message}`);
        console.error(`Ticket ${ticketUrl(ticket)} is a duplicate. Close it: tag wont-do, comment why, status Live.`);
        process.exit(3);
      }
      console.error(`NOT recorded, and task ${task} was left as it was: ${err.message}`);
      process.exit(1);
    }

  } else {
    const readTicket = async (id) => {
      const out = await call('GET', `/api/v2/task/${encodeURIComponent(id)}`);
      if (!out.res.ok) throw new Error(`reading ticket ${id} failed: HTTP ${out.res.status} ${String(out.json?.err || out.text || '').slice(0, 200)}`);
      return out.json;
    };
    let tally;
    try { tally = await syncBack({ db, readTicket, tool: LOOP_HANDOFF_TOOL }); } catch (err) { console.error(`Could not read the handed-off tasks: ${err.message}`); process.exit(1); }
    console.log(`sync: ${tally.done} done, ${tally.returned} handed back, ${tally.waiting} still with the agents, ${tally.failed} failed`);
    if (tally.failed) process.exitCode = 1;
  }
  reportLimits();

} else {
  console.error(`Unknown command "${cmd}".`);
  usage();
}
