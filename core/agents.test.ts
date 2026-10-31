import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentOrder, completeHandOff, handOffTask, returnHandOff, setAgentsOn, type MemberSettings, type MemberSettingsStore,
} from './agents.ts';
import { createTask, updateTask } from './tasks.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';

const task = (id: string, priority: string, createdAt: string, extra: object = {}) =>
  ({ id, priority, createdAt, status: 'todo', agentSelected: true, ...extra }) as never;

test('agentOrder puts urgent before high before normal before low', () => {
  const order = agentOrder([
    task('low', 'low', '2026-10-01T00:00:00Z'),
    task('normal', 'normal', '2026-10-01T00:00:00Z'),
    task('urgent', 'urgent', '2026-10-03T00:00:00Z'),
    task('high', 'high', '2026-10-02T00:00:00Z'),
  ]);
  assert.deepEqual(order.map((t: { id: string }) => t.id), ['urgent', 'high', 'normal', 'low']);
});

test('agentOrder takes the oldest first within a priority', () => {
  const order = agentOrder([
    task('newer', 'high', '2026-10-12T23:12:29Z'),
    task('older', 'high', '2026-10-12T23:09:22Z'),
    task('middle', 'high', '2026-10-12T23:10:49Z'),
  ]);
  assert.deepEqual(order.map((t: { id: string }) => t.id), ['older', 'middle', 'newer']);
});

test('agentOrder leaves out unticked, done, handed-over and proposed tasks', () => {
  const order = agentOrder([
    task('ticked', 'normal', '2026-10-01T00:00:00Z'),
    task('unticked', 'urgent', '2026-10-01T00:00:00Z', { agentSelected: false }),
    task('done', 'urgent', '2026-10-01T00:00:00Z', { status: 'done' }),
    task('handed', 'urgent', '2026-10-01T00:00:00Z', { agentTicketUrl: 'https://app.clickup.com/t/x' }),
    task('proposed', 'urgent', '2026-10-01T00:00:00Z', { status: 'proposed' }),
  ]);
  assert.deepEqual(order.map((t: { id: string }) => t.id), ['ticked']);
});

class MemorySettings implements MemberSettingsStore {
  row: MemberSettings | null = null;
  async get() { return this.row; }
  async save(settings: MemberSettings) { this.row = { ...settings }; return this.row; }
}

test('setAgentsOn saves the switch and the tool that flipped it', async () => {
  const store = new MemorySettings();
  assert.deepEqual(await setAgentsOn(store, true, 'wavecenter'), { agentsOn: true, tool: 'wavecenter' });
  assert.equal((await setAgentsOn(store, false, 'wavecenter')).agentsOn, false);
});

test('setAgentsOn refuses a missing tool, and says so when the save does not land', async () => {
  const store = new MemorySettings();
  await assert.rejects(setAgentsOn(store, true, ''), /must name the tool/);
  assert.equal(store.row, null);
  const broken: MemberSettingsStore = { get: async () => null, save: async () => null };
  await assert.rejects(setAgentsOn(broken, true, 'wavecenter'), /did not save/);
});

test('a task starts normal priority and unticked; priority and the tick change through updateTask', async () => {
  const store = new MemoryTaskStore();
  const made = await createTask(store, { title: 'Logo' }, 'wavecenter', 'admin');
  assert.equal(made.priority, 'normal');
  assert.equal(made.agentSelected, false);
  const changed = await updateTask(store, made.id, { priority: 'high', agentSelected: true }, 'wavecenter');
  assert.equal(changed.priority, 'high');
  assert.equal(changed.agentSelected, true);
  await assert.rejects(updateTask(store, made.id, { priority: 'someday' as never }, 'wavecenter'), /priority must be one of/);
});

test('a done task cannot be ticked for agents, and finishing a task unticks it', async () => {
  const store = new MemoryTaskStore();
  const made = await createTask(store, { title: 'Logo' }, 'wavecenter', 'admin');
  await updateTask(store, made.id, { agentSelected: true }, 'wavecenter');
  const done = await updateTask(store, made.id, { status: 'done' }, 'wavecenter');
  assert.equal(done.agentSelected, false);
  await assert.rejects(updateTask(store, made.id, { agentSelected: true }, 'wavecenter'), /done task cannot be handed/);
});

const TICKET = 'https://app.clickup.com/t/abc123';

async function tickedTask(store: MemoryTaskStore, title = 'Logo') {
  const made = await createTask(store, { title }, 'wavecenter', 'admin');
  return updateTask(store, made.id, { agentSelected: true }, 'wavecenter');
}

test('handOffTask records the ticket, makes the task doing and names the tool', async () => {
  const store = new MemoryTaskStore();
  const t = await tickedTask(store);
  const handed = await handOffTask(store, t.id, TICKET, 'loop-handoff');
  assert.equal(handed.status, 'doing');
  assert.equal(handed.agentTicketUrl, TICKET);
  assert.equal(handed.tool, 'loop-handoff');
  assert.equal(handed.agentSelected, true);
});

test('a task is never handed off twice, even when two passes race', async () => {
  const store = new MemoryTaskStore();
  const t = await tickedTask(store);
  await handOffTask(store, t.id, TICKET, 'loop-handoff');
  await assert.rejects(handOffTask(store, t.id, 'https://app.clickup.com/t/second', 'loop-handoff'), /already handed/);
  // The race: both passes read "no ticket", then the first one writes.
  const t2 = await tickedTask(store, 'Second');
  const racing = Object.create(store) as MemoryTaskStore;
  racing.get = async (id: string) => {
    const seen = await store.get(id);
    await store.update(id, { agentTicketUrl: 'https://app.clickup.com/t/first', tool: 'loop-handoff' });
    return seen;
  };
  await assert.rejects(handOffTask(racing, t2.id, 'https://app.clickup.com/t/late', 'loop-handoff'), /another pass first/);
  assert.equal((await store.get(t2.id))?.agentTicketUrl, 'https://app.clickup.com/t/first');
});

test('handOffTask refuses unticked, done or unknown tasks, a bad link and a missing tool, changing nothing', async () => {
  const store = new MemoryTaskStore();
  const plain = await createTask(store, { title: 'Not ticked' }, 'wavecenter', 'admin');
  await assert.rejects(handOffTask(store, plain.id, TICKET, 'loop-handoff'), /not ticked/);
  await assert.rejects(handOffTask(store, 'nope', TICKET, 'loop-handoff'), /No task/);
  const t = await tickedTask(store);
  await assert.rejects(handOffTask(store, t.id, 'not a link', 'loop-handoff'), /https/);
  await assert.rejects(handOffTask(store, t.id, TICKET, ''), /must name the tool/);
  assert.equal((await store.get(t.id))?.agentTicketUrl, null);
  assert.equal((await store.get(t.id))?.status, 'todo');
});

test('completeHandOff marks the task done and keeps the ticket link as the record', async () => {
  const store = new MemoryTaskStore();
  const t = await tickedTask(store);
  await handOffTask(store, t.id, TICKET, 'loop-handoff');
  const done = await completeHandOff(store, t.id, TICKET, 'loop-handoff');
  assert.equal(done.status, 'done');
  assert.equal(done.agentSelected, false);
  assert.equal(done.agentTicketUrl, TICKET);
  assert.ok(done.completedAt);
});

test('returnHandOff puts the task back to todo, unticked, with no ticket and a note saying why', async () => {
  const store = new MemoryTaskStore();
  const t = await tickedTask(store);
  await updateTask(store, t.id, { notes: 'Use the blue one.' }, 'wavecenter');
  await handOffTask(store, t.id, TICKET, 'loop-handoff');
  const back = await returnHandOff(store, t.id, TICKET, 'The agents did not build this: closed as wont-do.', 'loop-handoff');
  assert.equal(back.status, 'todo');
  assert.equal(back.agentSelected, false);
  assert.equal(back.agentTicketUrl, null);
  assert.equal(back.notes, 'Use the blue one.\n\nThe agents did not build this: closed as wont-do.');
  assert.equal(back.tool, 'loop-handoff');
});

test('completing or returning refuses a task no longer handed to that ticket', async () => {
  const store = new MemoryTaskStore();
  const t = await tickedTask(store);
  await assert.rejects(completeHandOff(store, t.id, TICKET, 'loop-handoff'), /no longer handed/);
  await assert.rejects(returnHandOff(store, t.id, TICKET, 'why', 'loop-handoff'), /no longer handed/);
  assert.equal((await store.get(t.id))?.status, 'todo');
});

test('reopening a done task forgets its old ticket, so ticking it again hands it over afresh', async () => {
  const store = new MemoryTaskStore();
  const t = await tickedTask(store);
  await handOffTask(store, t.id, TICKET, 'loop-handoff');
  await completeHandOff(store, t.id, TICKET, 'loop-handoff');
  const reopened = await updateTask(store, t.id, { status: 'todo' }, 'wavecenter');
  assert.equal(reopened.agentTicketUrl, null);
});

test('handOffTask refuses a proposed task, even one ticked by a client that went around core', async () => {
  const store = new MemoryTaskStore();
  const made = await createTask(store, { title: 'Idea' }, 'wavecenter', 'contributor');
  store.rows.get(made.id)!.agentSelected = true;
  await assert.rejects(handOffTask(store, made.id, 'https://app.clickup.com/t/abc', 'loop-handoff'), /still proposed/);
  assert.equal((await store.get(made.id))?.agentTicketUrl, null);
  assert.equal((await store.get(made.id))?.status, 'proposed');
});
