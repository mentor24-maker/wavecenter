import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, deleteTask, updateTask } from './tasks.ts';
import { CoreError } from './tool.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';

test('createTask fills in the defaults and records the tool', async () => {
  const store = new MemoryTaskStore('dane');
  const task = await createTask(store, { title: '  Buy milk ' }, 'wavecenter');
  assert.equal(task.title, 'Buy milk');
  assert.equal(task.status, 'todo');
  assert.equal(task.points, 0);
  assert.equal(task.parentTaskId, null);
  assert.equal(task.ownerId, 'dane');
  assert.equal(task.tool, 'wavecenter');
});

test('createTask can start a task with points and a parent', async () => {
  const store = new MemoryTaskStore();
  const parent = await createTask(store, { title: 'Plan' }, 'wavecenter');
  const child = await createTask(store, { title: 'Step one', parentTaskId: parent.id, points: 3 }, 'planner');
  assert.equal(child.parentTaskId, parent.id);
  assert.equal(child.points, 3);
  assert.equal(child.tool, 'planner');
});

test('createTask refuses a missing tool, a blank title, a bad status and bad points', async () => {
  const store = new MemoryTaskStore();
  await assert.rejects(createTask(store, { title: 'x' }, ''), /must name the tool/);
  await assert.rejects(createTask(store, { title: '   ' }, 'wavecenter'), /cannot be blank/);
  await assert.rejects(createTask(store, { title: 'x', status: 'later' as never }, 'wavecenter'), /status must be one of/);
  await assert.rejects(createTask(store, { title: 'x', points: 0.5 }, 'wavecenter'), /whole number/);
  assert.equal(store.rows.size, 0);
});

test('updateTask changes the record and stamps the tool that changed it', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Buy milk' }, 'wavecenter');
  const done = await updateTask(store, task.id, { title: 'Buy oat milk', status: 'done' }, 'phone-app');
  assert.equal(done.title, 'Buy oat milk');
  assert.equal(done.status, 'done');
  assert.ok(done.completedAt);
  assert.equal(done.tool, 'phone-app');
});

test('updateTask refuses a missing tool and changes nothing', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Buy milk' }, 'wavecenter');
  await assert.rejects(updateTask(store, task.id, { title: 'Other' }, '  '), (err: Error) =>
    err instanceof CoreError && /must name the tool/.test(err.message));
  assert.equal((await store.get(task.id))?.title, 'Buy milk');
});

test('updateTask will not change points, even if a caller slips them in', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Buy milk', points: 2 }, 'wavecenter');
  const sneaky = { title: 'Buy milk', points: 100 } as unknown as Parameters<typeof updateTask>[2];
  await assert.rejects(updateTask(store, task.id, sneaky, 'wavecenter'), /setPoints or awardPoints/);
  assert.equal((await store.get(task.id))?.points, 2);
});

test('updateTask refuses to make a task its own parent', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Loop' }, 'wavecenter');
  await assert.rejects(updateTask(store, task.id, { parentTaskId: task.id }, 'wavecenter'), /own parent/);
});

test('updateTask on a missing task says so', async () => {
  const store = new MemoryTaskStore();
  await assert.rejects(updateTask(store, 'task-404', { title: 'x' }, 'wavecenter'), /No task task-404/);
});

test('a parent must be a task you can see', async () => {
  const store = new MemoryTaskStore();
  await assert.rejects(createTask(store, { title: 'Orphan', parentTaskId: 'someone-elses' }, 'wavecenter'), /No task someone-elses/);
  const task = await createTask(store, { title: 'Mine' }, 'wavecenter');
  await assert.rejects(updateTask(store, task.id, { parentTaskId: 'someone-elses' }, 'wavecenter'), /No task someone-elses/);
  assert.equal(store.rows.size, 1);
  assert.equal((await store.get(task.id))?.parentTaskId, null);
});

test('a task cannot be put under its own sub-task, and can be made top-level again', async () => {
  const store = new MemoryTaskStore();
  const plan = await createTask(store, { title: 'Plan' }, 'wavecenter');
  const step = await createTask(store, { title: 'Step', parentTaskId: plan.id }, 'wavecenter');
  const detail = await createTask(store, { title: 'Detail', parentTaskId: step.id }, 'wavecenter');
  await assert.rejects(updateTask(store, plan.id, { parentTaskId: detail.id }, 'wavecenter'), /own sub-tasks/);
  assert.equal((await store.get(plan.id))?.parentTaskId, null);
  const loose = await updateTask(store, step.id, { parentTaskId: null }, 'wavecenter');
  assert.equal(loose.parentTaskId, null);
});

test('deleteTask removes the task, keeps its sub-tasks as top-level, and names its tool', async () => {
  const store = new MemoryTaskStore();
  const plan = await createTask(store, { title: 'Plan' }, 'wavecenter');
  const step = await createTask(store, { title: 'Step', parentTaskId: plan.id }, 'wavecenter');
  await assert.rejects(deleteTask(store, plan.id, ''), /must name the tool/);
  assert.ok(await store.get(plan.id), 'a refused delete deletes nothing');
  await deleteTask(store, plan.id, 'wavecenter');
  assert.equal(await store.get(plan.id), null);
  assert.equal((await store.get(step.id))?.parentTaskId, null);
  await assert.rejects(deleteTask(store, plan.id, 'wavecenter'), /No task .* you may delete/);
});

test('createTask saves details, a parent and a priority given together, and updateTask can clear the details', async () => {
  const store = new MemoryTaskStore();
  const parent = await createTask(store, { title: 'Plan' }, 'wavecenter');
  const task = await createTask(
    store,
    { title: 'Try the new add form', notes: 'Line one\nLine two', parentTaskId: parent.id, priority: 'high' },
    'wavecenter',
  );
  assert.equal(task.notes, 'Line one\nLine two');
  assert.equal(task.parentTaskId, parent.id);
  assert.equal(task.priority, 'high');
  assert.equal(task.tool, 'wavecenter');
  const cleared = await updateTask(store, task.id, { notes: null }, 'wavecenter');
  assert.equal(cleared.notes, null);
});
