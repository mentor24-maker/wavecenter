import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextHandOff, recordHandOff, syncBack, serviceDb, taskLine, ticketIdFromUrl, ticketPriority, ticketProblems,
  ticketOutcome, returnNote,
} from './handoff.mjs';
import { MemoryTaskStore } from '../../core/memoryTaskStore.ts';
import { createTask, updateTask } from '../../core/tasks.ts';
import { handOffTask } from '../../core/agents.ts';

const LIST = '901422159126';

/** A fake service-role database over core's memory store, answering the reads the lane makes. */
function fakeDb(store, agentsOn = ['member-1']) {
  const snake = (t) => ({
    id: t.id, title: t.title, notes: t.notes, owner_id: t.ownerId, status: t.status, parent_task_id: t.parentTaskId,
    points: t.points, position: t.position, priority: t.priority, agent_selected: t.agentSelected,
    agent_ticket_url: t.agentTicketUrl, tool: t.tool, created_at: t.createdAt, updated_at: t.updatedAt, completed_at: t.completedAt,
  });
  const reads = [];
  return {
    reads,
    store,
    async read(path) {
      reads.push(path);
      if (path.startsWith('member_settings')) return agentsOn.map((owner_id) => ({ owner_id }));
      const rows = [...store.rows.values()].map(snake);
      if (path.includes('agent_ticket_url=is.null')) {
        return rows.filter((r) => agentsOn.includes(r.owner_id) && r.agent_selected && r.status !== 'done' && !r.agent_ticket_url);
      }
      if (path.includes('agent_ticket_url=not.is.null')) return rows.filter((r) => r.agent_ticket_url && r.status !== 'done');
      throw new Error(`unexpected read ${path}`);
    },
  };
}

async function ticked(store, title, priority = 'normal') {
  const t = await createTask(store, { title, priority }, 'wavecenter');
  await new Promise((r) => setTimeout(r, 2)); // distinct created times
  return updateTask(store, t.id, { agentSelected: true }, 'wavecenter');
}

const ticketFor = (taskId, extra = {}) => ({
  id: 'abc123', name: 'Ticket', list: { id: LIST }, tags: [{ name: 'from-wavecenter' }],
  markdown_description: `## Goal\nx\n\n${taskLine(taskId)}\n`, status: { status: 'queued' }, ...extra,
});

test('the next hand-off is the first ticked task in agentOrder: priority, then oldest', async () => {
  const store = new MemoryTaskStore();
  await ticked(store, 'old normal');
  const high = await ticked(store, 'newer high', 'high');
  await ticked(store, 'newest high', 'high');
  const next = await nextHandOff(fakeDb(store));
  assert.equal(next.task?.id, high.id);
  assert.equal(next.waiting, 3);
});

test('with the switch off, nothing is handed over', async () => {
  const store = new MemoryTaskStore();
  await ticked(store, 'waiting');
  const db = fakeDb(store, []);
  const next = await nextHandOff(db);
  assert.equal(next.task, null);
  assert.match(next.why, /No member has "Launch AI Agents" on/);
  assert.equal(db.reads.length, 1, 'tasks are not even read');
});

test('a task already handed off is not offered again', async () => {
  const store = new MemoryTaskStore();
  const t = await ticked(store, 'only one');
  await handOffTask(store, t.id, 'https://app.clickup.com/t/first', 'loop-handoff');
  const next = await nextHandOff(fakeDb(store));
  assert.equal(next.task, null);
});

test('Urgent carries over only when the member set it on their own screen', () => {
  assert.equal(ticketPriority({ priority: 'urgent', tool: 'wavecenter' }), 'urgent');
  assert.equal(ticketPriority({ priority: 'urgent', tool: 'some-tool' }), 'high');
  assert.equal(ticketPriority({ priority: 'low', tool: 'some-tool' }), 'low');
});

test('recordHandOff records the ticket through core as loop-handoff', async () => {
  const store = new MemoryTaskStore();
  const t = await ticked(store, 'Logo');
  const saved = await recordHandOff({ db: fakeDb(store), ticket: ticketFor(t.id), taskId: t.id, listId: LIST, tool: 'loop-handoff' });
  assert.equal(saved.agentTicketUrl, 'https://app.clickup.com/t/abc123');
  assert.equal(saved.status, 'doing');
  assert.equal(saved.tool, 'loop-handoff');
});

test('a ticket that is not the one filed for this task is never recorded', async () => {
  const store = new MemoryTaskStore();
  const t = await ticked(store, 'Logo');
  const db = fakeDb(store);
  for (const ticket of [
    ticketFor('some-other-task'),
    ticketFor(t.id, { list: { id: '901418546619' } }),
    ticketFor(t.id, { tags: [] }),
  ]) {
    await assert.rejects(recordHandOff({ db, ticket, taskId: t.id, listId: LIST, tool: 'loop-handoff' }), /was not recorded/);
  }
  assert.equal((await store.get(t.id))?.agentTicketUrl, null);
  assert.equal(ticketProblems(ticketFor(t.id), t.id, LIST).length, 0);
});

test('a second ticket for the same task is refused, keeping the first', async () => {
  const store = new MemoryTaskStore();
  const t = await ticked(store, 'Logo');
  const db = fakeDb(store);
  await recordHandOff({ db, ticket: ticketFor(t.id), taskId: t.id, listId: LIST, tool: 'loop-handoff' });
  await assert.rejects(
    recordHandOff({ db, ticket: ticketFor(t.id, { id: 'dup999' }), taskId: t.id, listId: LIST, tool: 'loop-handoff' }),
    /already handed/,
  );
  assert.equal((await store.get(t.id))?.agentTicketUrl, 'https://app.clickup.com/t/abc123');
});

test('ticket outcomes: Live is done, Live with wont-do or deferred comes back, anything else waits', () => {
  assert.deepEqual(ticketOutcome({ status: { status: 'Live' }, tags: [] }), { action: 'done' });
  assert.deepEqual(ticketOutcome({ status: { status: 'live' }, tags: [{ name: 'wont-do' }] }), { action: 'return', tag: 'wont-do' });
  assert.deepEqual(ticketOutcome({ status: { status: 'live' }, tags: [{ name: 'Deferred' }] }), { action: 'return', tag: 'deferred' });
  assert.deepEqual(ticketOutcome({ status: { status: 'in review' }, tags: [{ name: 'wont-do' }] }), { action: 'wait' });
});

test('syncBack finishes, returns and leaves tasks by their tickets, and one failure does not stop the rest', async () => {
  const store = new MemoryTaskStore();
  const shipped = await ticked(store, 'Shipped');
  const dropped = await ticked(store, 'Dropped');
  const building = await ticked(store, 'Building');
  const broken = await ticked(store, 'Broken');
  await handOffTask(store, shipped.id, 'https://app.clickup.com/t/live1', 'loop-handoff');
  await handOffTask(store, dropped.id, 'https://app.clickup.com/t/wont1', 'loop-handoff');
  await handOffTask(store, building.id, 'https://app.clickup.com/t/build1', 'loop-handoff');
  await handOffTask(store, broken.id, 'https://app.clickup.com/t/gone1', 'loop-handoff');
  const tickets = {
    live1: { id: 'live1', name: 'Shipped', status: { status: 'live' }, tags: [] },
    wont1: { id: 'wont1', name: 'Dropped', status: { status: 'live' }, tags: [{ name: 'wont-do' }] },
    build1: { id: 'build1', name: 'Building', status: { status: 'building' }, tags: [] },
  };
  const lines = [];
  const tally = await syncBack({
    db: fakeDb(store),
    readTicket: async (id) => { if (!tickets[id]) throw new Error('HTTP 404'); return tickets[id]; },
    tool: 'loop-handoff',
    log: (l) => lines.push(l),
    now: new Date('2026-10-13T03:00:00Z'),
  });
  assert.deepEqual(tally, { done: 1, returned: 1, waiting: 1, failed: 1 });
  assert.equal((await store.get(shipped.id))?.status, 'done');
  const back = await store.get(dropped.id);
  assert.equal(back?.status, 'todo');
  assert.equal(back?.agentSelected, false);
  assert.equal(back?.agentTicketUrl, null);
  assert.equal(back?.tool, 'loop-handoff');
  assert.match(back?.notes ?? '', /^Handed back by the AI agents on 2026-10-12: the ticket "Dropped" .* closed as wont-do/);
  assert.equal((await store.get(building.id))?.status, 'doing');
  assert.equal((await store.get(broken.id))?.status, 'doing', 'a failed read leaves the task as it was');
  assert.ok(lines.some((l) => l.startsWith('FAILED') && l.includes('HTTP 404')));
});

test('ticket links are read strictly, and the note names the ticket', () => {
  assert.equal(ticketIdFromUrl('https://app.clickup.com/t/86bch40q7'), '86bch40q7');
  assert.equal(ticketIdFromUrl('https://evil.example/t/86bch40q7'), null);
  assert.match(returnNote({ id: 'x1', name: 'Logo' }, 'deferred'), /"Logo" \(https:\/\/app\.clickup\.com\/t\/x1\) was closed as deferred/);
});

test('the service database refuses to start without its settings, and a failed read throws', async () => {
  assert.throws(() => serviceDb({ url: 'https://x.supabase.co' }), /SUPABASE_SERVICE_ROLE_KEY/);
  const db = serviceDb({
    url: 'https://x.supabase.co', serviceKey: 'k',
    fetch: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  });
  await assert.rejects(db.read('member_settings?agents_on=eq.true'), /HTTP 500/);
});
