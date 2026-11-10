#!/usr/bin/env node
/**
 * WaveCenter's own commands: the ones that join a WaveCenter task (in the
 * Supabase database) to its ticket. Run through `npm run wavecenter -- <command>`,
 * which wraps this in `doppler run`, so the Supabase service key and the
 * tracker token reach only this process and are never printed.
 *
 * `npm run clickup` is Spirality's ticket door (loop/scripts/clickup.mjs), a
 * copy every Spirality project shares, so WaveCenter's own commands cannot
 * live there. They lived in WaveCenter's old door (scripts/clickup.mjs) until
 * the move to Spirality's loop (SP-23); they live here now, and read tickets
 * from the tracker the project config names.
 *
 *   chat-task --title "..." [--notes-file <f|->] [--points n] [--priority p]
 *       loop-spec: make the WaveCenter task, owned by Dane, for work he asked
 *       for in a chat, as JSON (id, taskLine, tag). Unticked, so the hand-off
 *       lane never files it.
 *   chat-record --task <wavecenter-id> --ticket <ticket-id>
 *       loop-spec: record the ticket filed for that task, through core
 *       (exit 3: it already had one; close the duplicate ticket).
 *   handoff-next [--take]
 *       the loop-handoff lane: the next ticked WaveCenter task, as JSON
 *       (exit 0), or why there is none (exit 3). Only --take (the lane's own
 *       pass) counts as taking it.
 *   handoff-record --task <wavecenter-id> --ticket <ticket-id>
 *       record a filed ticket on its task, through core (exit 3: it already
 *       had one; close the duplicate ticket).
 *   handoff-sync
 *       finished tickets back to their tasks: Live -> done; Live with wont-do
 *       or deferred -> todo, unticked, with a note. Tasks handed off before
 *       the move still carry a ClickUp link; those are read from ClickUp.
 *   ticket-json --ticket <link|id>
 *       read-only, for the Evolution pictures (scripts/evolution_capture.mjs):
 *       the ticket's link, tags, body and comments (oldest first) as one JSON
 *       line. A tracker ticket (WC-12, or its page) is read from the tracker;
 *       a ClickUp ticket from before the move, from ClickUp.
 *
 * Exit codes: 0 done, 1 failed (nothing was changed), 2 usage, 3 as above.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  nextHandOff, recordHandOff, recordChatTicket, createChatTask, DANE_MEMBER_ID, serviceDb, syncBack, taskLine,
  ticketPriority as ticketPriorityOf, ticketUrl, FROM_WAVECENTER_TAG, emptyTakes, withTake, skipLine,
} from './lib/handoff.mjs';
import { ticketRef } from './lib/ticketLinks.mjs';
import { CoreError, LOOP_HANDOFF_TOOL, LOOP_SPEC_TOOL } from '../core/tool.ts';
import { loadProjectConfig, ProjectConfigError } from '../loop/lib/projectConfig.mjs';
import { createApiTracker, trackerTokenEnv } from '../loop/scripts/tracker/apiTracker.mjs';
import { projectSeats } from '../loop/scripts/lib/expectedSecrets.mjs';
import { createClickupTracker } from '../loop/scripts/tracker/clickupTracker.mjs';

const USAGE = `usage: npm run wavecenter -- <command>
  chat-task --title "..." [--notes-file <f|->] [--points n] [--priority p]
  chat-record --task <wavecenter-id> --ticket <ticket-id>
  handoff-next [--take]
  handoff-record --task <wavecenter-id> --ticket <ticket-id>
  handoff-sync
  ticket-json --ticket <link|id>
(see the top of scripts/wavecenter_tasks.mjs for what each one does)`;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }
function usage() { console.error(USAGE); process.exit(2); }
function readBody(file) { return readFileSync(file === '-' ? 0 : file, 'utf8'); }

const cmd = process.argv[2];
const COMMANDS = ['chat-task', 'chat-record', 'handoff-next', 'handoff-record', 'handoff-sync', 'ticket-json'];
if (!cmd || cmd === '--help' || cmd === 'help') usage();
if (!COMMANDS.includes(cmd)) {
  console.error(`Unknown command "${cmd}". Ticket commands (task, comment, status, ask, ...) are Spirality's door: npm run clickup -- ${cmd}`);
  usage();
}

let project;
try {
  project = loadProjectConfig();
} catch (err) {
  if (!(err instanceof ProjectConfigError)) throw err;
  console.error(`wavecenter: the project config is not usable — ${err.message}`);
  process.exit(1);
}

// The ticket a task is joined to is read from the project's tracker. On the
// tracker, its one "list" is the project (apiTracker.mjs answers list.id with
// the project slug); on ClickUp, it is the Loop Queue list.
const ON_TRACKER = project.tracker === 'api';
const QUEUE = ON_TRACKER ? project.projectSlug : project.loopQueueListId;
// The link a task records is the tracker's public https address (core
// records only https links, and Dane's screen shows it); the sync reads that
// and the local address both.
const TRACKER_URL = ON_TRACKER ? project.trackerPublicUrl : null;
const TRACKER_URLS = ON_TRACKER ? [project.trackerPublicUrl, project.trackerUrl] : [];
if (ON_TRACKER && !TRACKER_URL && ['chat-record', 'handoff-record'].includes(cmd)) {
  console.error('wavecenter: NOT recorded, nothing was changed: spirality.project.json names no trackerPublicUrl, and a task records only an https ticket link.');
  process.exit(1);
}

let tracker = null;
/**
 * The tracker door, signed in as this caller's own seat: the project's own
 * lanes (`projectLanes`, loop-handoff) count as seats too (projectSeats), or
 * the hand-off lane's every pass is refused. A refused sign-in THROWS, never
 * exits, so handoff-sync logs that one task as failed and carries on with
 * the rest (review of WC-162, round 3); each command's own catch says it.
 */
function theTracker() {
  if (tracker) return tracker;
  if (ON_TRACKER) {
    let env;
    try { env = trackerTokenEnv(process.env, projectSeats(project)); } catch (err) { throw new Error(`could not sign in to the tracker: ${err.message}`); }
    tracker = createApiTracker({
      token: process.env[env], baseUrl: project.trackerApiUrl, project: project.projectSlug,
      listId: project.loopQueueListId, timeoutMs: process.env.TRACKER_HTTP_TIMEOUT_MS,
    });
  } else {
    tracker = clickup();
  }
  return tracker;
}
let clickupDoor = null;
function clickup() {
  clickupDoor ??= createClickupTracker({
    token: process.env.CLICKUP_API_TOKEN, apiBase: process.env.CLICKUP_API_BASE, timeoutMs: process.env.CLICKUP_HTTP_TIMEOUT_MS,
  });
  return clickupDoor;
}

/** The ticket, in ClickUp's task shape, or throws saying why it could not be read. */
async function readTicket({ where, id }) {
  const door = where === 'clickup' ? clickup() : theTracker();
  const out = await door.getTask(id, { markdown: true });
  if (!out.res.ok || !out.json?.id) {
    throw new Error(`reading ticket ${id} failed: HTTP ${out.res.status} ${String(out.json?.err || out.json?.error || out.text || '').slice(0, 200)}`);
  }
  return out.json;
}
const here = ON_TRACKER ? 'tracker' : 'clickup';

function duplicate(err, ticket) {
  console.error(`NOT recorded: ${err.message}`);
  console.error(`Ticket ${ticketUrl(ticket, TRACKER_URL)} is a duplicate. Close it: npm run clickup -- tag --task ${ticket} --add wont-do, a comment saying why, then status Live.`);
  process.exit(3);
}

function db(owner) {
  try {
    return serviceDb({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY, owner });
  } catch (err) { console.error(err.message); process.exit(1); }
}

async function record(kind) {
  const task = arg('task'), ticket = arg('ticket');
  if (!task || !ticket) usage();
  const isChat = kind === 'chat';
  const database = db(isChat ? DANE_MEMBER_ID : undefined);
  let json;
  try { json = await readTicket({ where: here, id: ticket }); } catch (err) {
    console.error(`NOT recorded, and task ${task} was left as it was: ${err.message}`);
    process.exit(1);
  }
  const recordIt = isChat ? recordChatTicket : recordHandOff;
  try {
    const saved = await recordIt({
      db: database, ticket: json, taskId: task, listId: QUEUE, tool: isChat ? LOOP_SPEC_TOOL : LOOP_HANDOFF_TOOL, trackerUrl: TRACKER_URL,
    });
    console.log(`Task ${task} "${saved.title}": now with AI agents, status ${saved.status}, ticket ${saved.agentTicketUrl}.`);
  } catch (err) {
    if (err instanceof CoreError && /already handed|another pass first/.test(err.message)) duplicate(err, ticket);
    console.error(`NOT recorded, and task ${task} was left as it was: ${err.message}`);
    process.exit(1);
  }
}

if (cmd === 'chat-task') {
  // Every change Dane asks for starts as a WaveCenter task (Dane, 2026-11-01:
  // "Yes, always a task"), chat requests included, so each Evolution card can
  // credit him. loop-spec makes his task, files the ticket, then records it.
  const title = arg('title');
  if (!title) usage();
  const notesFile = arg('notes-file');
  const points = arg('points') === null ? 0 : Number(arg('points'));
  let t;
  try {
    t = await createChatTask({
      db: db(DANE_MEMBER_ID), title, notes: notesFile ? readBody(notesFile) : null, points, priority: arg('priority', 'normal'), tool: LOOP_SPEC_TOOL,
    });
  } catch (err) { console.error(`NOT made, nothing was saved: ${err.message}`); process.exit(1); }
  console.log(JSON.stringify({ id: t.id, title: t.title, notes: t.notes, points: t.points, status: t.status, taskLine: taskLine(t.id), tag: FROM_WAVECENTER_TAG }, null, 2));
  console.error(`Made task ${t.id} "${t.title}" for Dane (${t.status}, ${t.points} point(s)). File its ticket, then: npm run wavecenter -- chat-record --task ${t.id} --ticket <ticket-id>`);
} else if (cmd === 'chat-record') {
  await record('chat');
} else if (cmd === 'handoff-record') {
  await record('handoff');
} else if (cmd === 'handoff-next') {
  // Which task each pass took, so one the lane keeps freezing on is skipped
  // (2026-10-30). On the Mini, beside the lane log; never on Vercel.
  const database = db();
  const logDir = process.env.LOOP_LOG_DIR || join(homedir(), 'loop-logs');
  const takesFile = join(logDir, 'wavecenter-handoff-takes.json');
  const laneLog = join(logDir, 'wavecenter-loop-handoff.log');
  let takes = emptyTakes();
  try {
    const saved = JSON.parse(readFileSync(takesFile, 'utf8'));
    if (saved && typeof saved.takes === 'object' && saved.takes) takes = saved;
    else console.error(`${takesFile} is not a record of takes; starting it afresh.`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not read ${takesFile} (${err.message}); starting it afresh.`);
  }
  let next;
  try { next = await nextHandOff(database, takes); } catch (err) { console.error(`Could not read the ticked tasks: ${err.message}`); process.exit(1); }
  const take = flag('take');
  const lines = next.skipped.map(skipLine);
  for (const line of lines) console.error(line);
  if (take) {
    const updated = next.task ? withTake(next.takes, next.task) : next.takes;
    try {
      mkdirSync(logDir, { recursive: true });
      writeFileSync(`${takesFile}.tmp`, `${JSON.stringify(updated, null, 2)}\n`);
      renameSync(`${takesFile}.tmp`, takesFile);
    } catch (err) {
      console.error(`WARNING: this take was NOT remembered (${err.message}), so a task this pass freezes on will not be skipped next time.`);
    }
    if (lines.length) {
      const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour12: false });
      try { appendFileSync(laneLog, lines.map((l) => `[handoff-next] ${stamp} Mountain ${l}\n`).join('')); }
      catch (err) { console.error(`Could not write the skip to ${laneLog}: ${err.message}`); }
    }
  }
  if (!next.task) { console.error(next.why); process.exit(3); }
  const t = next.task;
  console.log(JSON.stringify({
    id: t.id, title: t.title, notes: t.notes, priority: t.priority, ticketPriority: ticketPriorityOf(t),
    createdAt: t.createdAt, taskLine: taskLine(t.id), tag: FROM_WAVECENTER_TAG,
    skipped: next.skipped.map((s) => ({ id: s.task.id, title: s.task.title, takes: s.count })),
  }, null, 2));
  console.error(`${next.waiting} ticked task(s) waiting; this is the first in line${lines.length ? ` after ${lines.length} skipped` : ''}.`);
  if (!take) console.error('(Not counted as a take: only the lane\'s own pass, with --take, counts.)');
} else if (cmd === 'ticket-json') {
  const given = arg('ticket');
  if (!given) usage();
  const ref = ticketRef(given, TRACKER_URLS)
    ?? (/^[A-Za-z]+-[0-9]+$/.test(given) ? { where: here, id: given.toUpperCase() }
      : /^[A-Za-z0-9]+$/.test(given) ? { where: 'clickup', id: given } : null);
  if (!ref) { console.error(`"${given}" is not a ticket link or id this project knows.`); process.exit(2); }
  let door;
  try { door = ref.where === 'clickup' ? clickup() : theTracker(); } catch (err) { console.error(`wavecenter: ${err.message}`); process.exit(1); }
  const link = ref.where === 'clickup' ? ticketUrl(ref.id) : ticketUrl(ref.id, TRACKER_URL);
  /** Every top-level comment, oldest first, or exits saying it could not read them. */
  const commentsOf = async () => {
    const out = await door.listComments(ref.id);
    if (out.bad || !out.paged?.complete) {
      console.error(`could not read the comments on ticket ${ref.id}: HTTP ${out.bad?.res?.status ?? '?'}`);
      process.exit(1);
    }
    return [...out.paged.comments].reverse();
  };
  let t;
  try { t = await readTicket(ref); } catch (err) { console.error(err.message); process.exit(1); }
  const comments = await commentsOf();
  console.log(JSON.stringify({
    id: t.id,
    url: link,
    tags: (t.tags || []).map((x) => x.name),
    description: t.markdown_description || t.description || '',
    comments: comments.map((c) => ({ text: c.comment_text || '', date: c.date })),
  }));
} else {
  let tally;
  try {
    tally = await syncBack({ db: db(), readTicket, tool: LOOP_HANDOFF_TOOL, trackerUrls: TRACKER_URLS });
  } catch (err) { console.error(`Could not read the handed-off tasks: ${err.message}`); process.exit(1); }
  console.log(`sync: ${tally.done} done, ${tally.returned} handed back, ${tally.waiting} still with the agents, ${tally.failed} failed`);
  if (tally.failed) process.exitCode = 1;
}
