import test from 'node:test';
import assert from 'node:assert/strict';
import { agentOrder, setAgentsOn, type MemberSettings, type MemberSettingsStore } from './agents.ts';
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

test('agentOrder leaves out unticked and done tasks', () => {
  const order = agentOrder([
    task('ticked', 'normal', '2026-10-01T00:00:00Z'),
    task('unticked', 'urgent', '2026-10-01T00:00:00Z', { agentSelected: false }),
    task('done', 'urgent', '2026-10-01T00:00:00Z', { status: 'done' }),
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
  const made = await createTask(store, { title: 'Logo' }, 'wavecenter');
  assert.equal(made.priority, 'normal');
  assert.equal(made.agentSelected, false);
  const changed = await updateTask(store, made.id, { priority: 'high', agentSelected: true }, 'wavecenter');
  assert.equal(changed.priority, 'high');
  assert.equal(changed.agentSelected, true);
  await assert.rejects(updateTask(store, made.id, { priority: 'someday' as never }, 'wavecenter'), /priority must be one of/);
});

test('a done task cannot be ticked for agents, and finishing a task unticks it', async () => {
  const store = new MemoryTaskStore();
  const made = await createTask(store, { title: 'Logo' }, 'wavecenter');
  await updateTask(store, made.id, { agentSelected: true }, 'wavecenter');
  const done = await updateTask(store, made.id, { status: 'done' }, 'wavecenter');
  assert.equal(done.agentSelected, false);
  await assert.rejects(updateTask(store, made.id, { agentSelected: true }, 'wavecenter'), /done task cannot be handed/);
});
