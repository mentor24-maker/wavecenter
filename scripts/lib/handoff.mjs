/**
 * The loop-handoff lane's database side: which ticked task goes next, the
 * checks before a filed ticket is recorded on its task, and the sync back
 * from finished tickets. `scripts/wavecenter_tasks.mjs` (`npm run wavecenter --
 * handoff-next | handoff-record | handoff-sync`) is the only caller; the skill
 * is .claude/skills/loop-handoff.
 * Work Dane asks for in a chat comes the same way (chat-task, chat-record,
 * from .claude/skills/loop-spec): a task of his first, then its ticket.
 *
 * It reads with the Supabase service key, which sees every member's tasks, so
 * it only ever runs on the Mini under Doppler. The key never reaches app/ or
 * a browser (engineering rule 3). Every task change goes through core
 * (core/agents.ts) as the tool `loop-handoff`.
 *
 * @typedef {import('../../core/tasks.ts').Task} Task
 */
import { agentOrder, completeHandOff, handOffChatTask, handOffTask, returnHandOff } from '../../core/agents.ts';
import { createTask } from '../../core/tasks.ts';
import { fromRow, restTaskStore } from './restTaskStore.mjs';

export const FROM_WAVECENTER_TAG = 'from-wavecenter';
/** A Live ticket carrying one of these was closed without being built. */
export const RETURN_TAGS = ['wont-do', 'deferred'];

/** The line every handed-off ticket carries, naming its WaveCenter task. */
export function taskLine(taskId) {
  return `WaveCenter task: ${taskId}`;
}

/**
 * A ticket's link, the one a task records and Dane's screen shows. With
 * `trackerUrl`, the tracker's own page, `<trackerUrl>/t/WC-12`: every ticket
 * since the move to the tracker (SP-23). The caller passes the tracker's
 * public https address (the project config's `trackerPublicUrl`), because
 * core records only https links. Without it, the ClickUp link the tasks
 * handed off before the move still carry.
 */
export function ticketUrl(ticketId, trackerUrl = null) {
  if (trackerUrl) return `${String(trackerUrl).replace(/\/+$/, '')}/t/${ticketId}`;
  return `https://app.clickup.com/t/${ticketId}`;
}

/** The ClickUp ticket id in a ticket link, or null. */
export function ticketIdFromUrl(url) {
  const m = /^https:\/\/app\.clickup\.com\/t\/([A-Za-z0-9]+)\/?$/.exec(String(url ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Where a recorded ticket link points: `{ where: 'tracker', id }` for a
 * tracker page (`<address>/t/WC-12`, at any of `trackerUrls`: the public
 * address and the local one), `{ where: 'clickup', id }` for a ClickUp link
 * from before the move, or null for anything else.
 * @param {unknown} url
 * @param {string | null | Array<string | null | undefined>} trackerUrls
 */
export function ticketRef(url, trackerUrls = []) {
  const text = String(url ?? '').trim();
  for (const base of [trackerUrls].flat()) {
    if (!base) continue;
    const escaped = String(base).replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`^${escaped}/t/([A-Za-z]+-[0-9]+)/?$`).exec(text);
    if (m) return { where: 'tracker', id: m[1].toUpperCase() };
  }
  const id = ticketIdFromUrl(text);
  return id ? { where: 'clickup', id } : null;
}

/**
 * The ticket's priority: the task's own, except that Urgent is Dane's lane in
 * the Loop Queue, so it only carries over when the member set it on their own
 * screen (the task's last change was made by `wavecenter`). Otherwise High.
 * @param {Pick<Task, 'priority' | 'tool'>} task
 */
export function ticketPriority(task) {
  if (task.priority !== 'urgent') return task.priority;
  return task.tool === 'wavecenter' ? 'urgent' : 'high';
}

/**
 * The database, as the service role. `read` is a plain GET that throws on any
 * failure; `store` is core's TaskStore over the same key. `owner` is the
 * member any task the store makes belongs to (see restTaskStore).
 * @param {{ url?: string, serviceKey?: string, owner?: string, fetch?: typeof fetch }} options
 */
export function serviceDb({ url, serviceKey, owner, fetch: fetchFn = fetch }) {
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set (Doppler wavecenter/dev supplies them).');
  }
  return {
    async read(path) {
      const res = await fetchFn(`${url}/rest/v1/${path}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`reading ${path.split('?')[0]} failed: HTTP ${res.status} ${text}`);
      return text ? JSON.parse(text) : [];
    },
    store: restTaskStore({ url, apiKey: serviceKey, token: serviceKey, owner, fetch: fetchFn }),
  };
}

/**
 * How many passes may take the same task without recording a ticket before
 * the lane skips it. On 2026-10-30 three passes in a row froze on one task and
 * the ten behind it waited five hours.
 */
export const SKIP_AFTER_TAKES = 2;

/**
 * The lane's memory of which task each pass took (`handoff-next --take`):
 * `{ takes: { [taskId]: { title, updatedAt, count, lastAt } } }`. It lives in
 * a small file on the Mini (scripts/clickup.mjs reads and writes it); these
 * functions only work on the plain object.
 */
export function emptyTakes() {
  return { takes: {} };
}

/** A take still counts only while the task is unchanged: an edit, an untick and re-tick, all start it afresh. */
function takeOf(takes, task) {
  const entry = takes?.takes?.[task.id];
  return entry && entry.updatedAt === task.updatedAt ? entry : null;
}

/**
 * Pick from the waiting line, skipping every task that `skipAfter` passes
 * already took without recording a ticket. Returns the pick, the skipped
 * tasks (with how often they were taken), and the takes with every task that
 * left the line (got a ticket, unticked, done) or changed since forgotten.
 * @param {Task[]} line in agentOrder
 */
export function pickFromLine(line, takes, { skipAfter = SKIP_AFTER_TAKES } = {}) {
  const kept = emptyTakes();
  for (const t of line) {
    const entry = takeOf(takes, t);
    if (entry) kept.takes[t.id] = entry;
  }
  const skipped = [];
  let task = null;
  for (const t of line) {
    const count = kept.takes[t.id]?.count ?? 0;
    if (count >= skipAfter) { skipped.push({ task: t, count, lastAt: kept.takes[t.id].lastAt }); continue; }
    task = t;
    break;
  }
  return { task, skipped, takes: kept };
}

/** The takes after a pass took `task`. Never changes the object it is given. */
export function withTake(takes, task, now = new Date()) {
  const count = (takeOf(takes, task)?.count ?? 0) + 1;
  return { takes: { ...takes.takes, [task.id]: { title: task.title, updatedAt: task.updatedAt, count, lastAt: now.toISOString() } } };
}

/** The plain-words line for a skipped task, for the pass report and the lane log. */
export function skipLine({ task, count, lastAt }) {
  const when = lastAt ? `, last at ${new Date(lastAt).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' })} Mountain` : '';
  return `SKIPPED "${task.title}" (task ${task.id}): ${count} pass(es) took it and none recorded a ticket${when}. `
    + 'It stays skipped until it gets a ticket, is edited, or is unticked and ticked again.';
}

/**
 * The next task to hand off: of every member whose switch is on, their
 * ticked, unfinished tasks with no ticket yet, in `agentOrder`, skipping any
 * task the lane is stuck on (see `pickFromLine`).
 * @returns {Promise<{ task: Task | null, waiting: number, skipped: any[], takes: any, why?: string }>}
 */
export async function nextHandOff(db, takes = emptyTakes()) {
  const members = await db.read('member_settings?agents_on=eq.true&select=owner_id');
  if (!members.length) return { task: null, waiting: 0, skipped: [], takes: emptyTakes(), why: 'No member has "Launch AI Agents" on, so nothing is handed over.' };
  const owners = members.map((m) => m.owner_id).join(',');
  const rows = await db.read(
    `tasks?owner_id=in.(${owners})&agent_selected=eq.true&status=neq.done&agent_ticket_url=is.null&select=*`,
  );
  const line = agentOrder(rows.map(fromRow));
  if (!line.length) return { task: null, waiting: 0, skipped: [], takes: emptyTakes(), why: `${members.length} member(s) have agents on, but no ticked task is waiting.` };
  const pick = pickFromLine(line, takes);
  if (!pick.task) {
    return { ...pick, waiting: line.length, why: `All ${line.length} ticked task(s) waiting are skipped: the lane got stuck on each one.` };
  }
  return { ...pick, waiting: line.length };
}

/**
 * Why a filed ticket may not be recorded on `taskId`, or an empty list.
 * @param {any} ticket ClickUp's task JSON
 */
export function ticketProblems(ticket, taskId, listId) {
  const problems = [];
  if (String(ticket?.list?.id) !== String(listId)) problems.push(`it is not in the Loop Queue (list ${listId})`);
  const body = `${ticket?.markdown_description ?? ''}\n${ticket?.description ?? ''}`;
  if (!body.includes(taskLine(taskId))) problems.push(`its description does not carry the line "${taskLine(taskId)}"`);
  const tags = (ticket?.tags || []).map((t) => String(t.name).toLowerCase());
  if (!tags.includes(FROM_WAVECENTER_TAG)) problems.push(`it is not tagged ${FROM_WAVECENTER_TAG}`);
  return problems;
}

/**
 * Record a filed ticket on its task, through core. Refuses (and changes
 * nothing) if the ticket is not the one filed for this task. `trackerUrl`
 * makes the recorded link the tracker's page (see ticketUrl).
 */
export async function recordHandOff({ db, ticket, taskId, listId, tool, trackerUrl = null }) {
  const problems = ticketProblems(ticket, taskId, listId);
  if (problems.length) throw new Error(`Ticket ${ticket?.id ?? '?'} was not recorded: ${problems.join('; ')}.`);
  return handOffTask(db.store, taskId, ticketUrl(ticket.id, trackerUrl), tool);
}

/**
 * Dane's member account, the earliest one (20261029120000_member_roles.sql
 * makes it the first admin). Work he asks for in a chat is his task.
 */
export const DANE_MEMBER_ID = '3cb23781-b16b-4fae-93e0-85e51915641c';

/**
 * Make the WaveCenter task for work Dane asked for in a chat, owned by him,
 * through core: his words as title and notes, points 0 unless he gave a
 * number. It starts unticked, so the hand-off lane never files it;
 * `recordChatTicket` ticks it and records its ticket in one write. Its
 * status follows his role (an admin's task starts as todo), read from the
 * database rather than assumed. `db` must be a serviceDb made with
 * `owner: DANE_MEMBER_ID`.
 */
export async function createChatTask({ db, title, notes = null, points = 0, priority = 'normal', tool }) {
  const [role] = await db.read(`member_roles?member_id=eq.${DANE_MEMBER_ID}&select=role`);
  return createTask(db.store, { title, notes: notes?.trim() ? notes.trim() : null, points, priority }, tool, role?.role);
}

/**
 * Record a ticket filed by loop-spec on the chat task made for it. The same
 * checks as `recordHandOff` (in the Loop Queue, tagged from-wavecenter,
 * carrying the task line); refuses, changing nothing, if any fails.
 */
export async function recordChatTicket({ db, ticket, taskId, listId, tool, trackerUrl = null }) {
  const problems = ticketProblems(ticket, taskId, listId);
  if (problems.length) throw new Error(`Ticket ${ticket?.id ?? '?'} was not recorded: ${problems.join('; ')}.`);
  return handOffChatTask(db.store, taskId, ticketUrl(ticket.id, trackerUrl), tool);
}

function mountainDate(now) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
}

/** The note a handed-back task gets, in plain words. */
export function returnNote(ticket, tag, now = new Date(), url = ticketUrl(ticket.id)) {
  return `Handed back by the AI agents on ${mountainDate(now)}: the ticket "${ticket.name}" (${url}) `
    + `was closed as ${tag}, so it was not built. Tick the AI box again to hand it over afresh.`;
}

/**
 * What a ticket's state means for its task: 'done', 'return' (with the tag),
 * or 'wait' while it is still being worked.
 */
export function ticketOutcome(ticket) {
  if (String(ticket?.status?.status ?? '').trim().toLowerCase() !== 'live') return { action: 'wait' };
  const tags = (ticket.tags || []).map((t) => String(t.name).toLowerCase());
  const tag = RETURN_TAGS.find((t) => tags.includes(t));
  return tag ? { action: 'return', tag } : { action: 'done' };
}

/**
 * Bring finished tickets back to their tasks: every handed-off task not yet
 * done is checked against its ticket. One task's failure is logged and the
 * rest carry on; a failed read or write leaves that task as it was.
 * `readTicket(ref)` takes a ticketRef (`{ where, id }`) and resolves to the
 * ticket in ClickUp's task shape (the tracker door answers in it too), or
 * throws. `trackerUrls` are the tracker addresses whose links it reads (see
 * ticketRef).
 */
export async function syncBack({ db, readTicket, tool, trackerUrls = [], log = console.log, now = new Date() }) {
  const rows = await db.read('tasks?agent_ticket_url=not.is.null&status=neq.done&select=*');
  const tally = { done: 0, returned: 0, waiting: 0, failed: 0 };
  for (const task of rows.map(fromRow)) {
    const url = /** @type {string} */ (task.agentTicketUrl);
    try {
      const ref = ticketRef(url, trackerUrls);
      if (!ref) throw new Error(`its ticket link "${url}" is neither a tracker nor a ClickUp ticket link`);
      const ticket = await readTicket(ref);
      const outcome = ticketOutcome(ticket);
      if (outcome.action === 'done') {
        await completeHandOff(db.store, task.id, url, tool);
        tally.done += 1;
        log(`DONE      "${task.title}" — its ticket went Live (${url})`);
      } else if (outcome.action === 'return') {
        await returnHandOff(db.store, task.id, url, returnNote(ticket, outcome.tag, now, url), tool);
        tally.returned += 1;
        log(`RETURNED  "${task.title}" — its ticket was closed as ${outcome.tag} (${url})`);
      } else {
        tally.waiting += 1;
      }
    } catch (err) {
      tally.failed += 1;
      log(`FAILED    "${task.title}" was left as it was: ${err?.message ?? err}`);
    }
  }
  return tally;
}
