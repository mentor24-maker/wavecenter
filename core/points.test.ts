import test from 'node:test';
import assert from 'node:assert/strict';
import { awardPoints, requirePointsValue, setPoints } from './points.ts';
import { createTask, updateTask } from './tasks.ts';
import { CoreError } from './tool.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';

async function oneTask(points = 0) {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Write the plan', points }, 'wavecenter');
  return { store, task };
}

test('setPoints changes the points, names the tool, and reports the change', async () => {
  const { store, task } = await oneTask(2);
  const change = await setPoints(store, task.id, 8, 'planner');
  assert.equal(change.before, 2);
  assert.equal(change.after, 8);
  assert.equal(change.delta, 6);
  assert.equal(change.tool, 'planner');
  assert.equal(change.taskId, task.id);
  const stored = await store.get(task.id);
  assert.equal(stored?.points, 8);
  assert.equal(stored?.tool, 'planner');
});

test('awardPoints adds to what the task already has', async () => {
  const { store, task } = await oneTask(5);
  const change = await awardPoints(store, task.id, 3, 'wavecenter');
  assert.deepEqual([change.before, change.after, change.delta], [5, 8, 3]);
  assert.equal((await store.get(task.id))?.points, 8);
});

for (const tool of [undefined, '', '   ']) {
  test(`a points change with no tool name (${JSON.stringify(tool)}) is refused and nothing changes`, async () => {
    const { store, task } = await oneTask(4);
    await assert.rejects(setPoints(store, task.id, 9, tool as unknown as string), (err: Error) =>
      err instanceof CoreError && /must name the tool/.test(err.message));
    await assert.rejects(awardPoints(store, task.id, 1, tool as unknown as string), /must name the tool/);
    assert.equal((await store.get(task.id))?.points, 4);
  });
}

test('points must be a whole number the table can hold', async () => {
  const { store, task } = await oneTask();
  for (const bad of [1.5, Number.NaN, Infinity, '3', 2_147_483_648]) {
    await assert.rejects(setPoints(store, task.id, bad as number, 'wavecenter'), CoreError);
  }
  assert.equal(requirePointsValue(0), 0);
  assert.equal((await store.get(task.id))?.points, 0);
});

test('points can never be negative, and nothing is saved', async () => {
  const { store, task } = await oneTask(4);
  await assert.rejects(setPoints(store, task.id, -1, 'wavecenter'), (err: Error) =>
    err instanceof CoreError && err.message === "Points can't be negative; got -1.");
  assert.throws(() => requirePointsValue(-3), /can't be negative; got -3/);
  assert.equal((await store.get(task.id))?.points, 4);
});

test('a done task\'s points are locked, and nothing is saved', async () => {
  const { store, task } = await oneTask(5);
  await updateTask(store, task.id, { status: 'done' }, 'wavecenter');
  await assert.rejects(setPoints(store, task.id, 8, 'wavecenter'), (err: Error) =>
    err instanceof CoreError && /done, so its points are locked\. Reopen it/.test(err.message));
  await assert.rejects(awardPoints(store, task.id, 3, 'wavecenter'), /points are locked/);
  const stored = await store.get(task.id);
  assert.equal(stored?.points, 5);
  assert.equal(stored?.tool, 'wavecenter');
});

test('reopening a done task unlocks its points', async () => {
  const { store, task } = await oneTask(5);
  await updateTask(store, task.id, { status: 'done' }, 'wavecenter');
  await updateTask(store, task.id, { status: 'todo' }, 'wavecenter');
  const change = await setPoints(store, task.id, 8, 'wavecenter');
  assert.equal(change.after, 8);
  assert.equal((await store.get(task.id))?.points, 8);
});

test('a task finished while its points were being changed keeps them locked', async () => {
  const { store, task } = await oneTask(1);
  const realGet = store.get.bind(store);
  // The task is ticked off right after this change reads it.
  store.get = async (id) => {
    const seen = await realGet(id);
    store.rows.set(id, { ...store.rows.get(id)!, status: 'done' });
    return seen;
  };
  await assert.rejects(setPoints(store, task.id, 9, 'wavecenter'), /changed while this change was being made/);
  assert.equal(store.rows.get(task.id)?.points, 1);
});

test('an award must be more than zero', async () => {
  const { store, task } = await oneTask(5);
  await assert.rejects(awardPoints(store, task.id, 0, 'wavecenter'), /more than zero/);
  await assert.rejects(awardPoints(store, task.id, -2, 'wavecenter'), /more than zero/);
  assert.equal((await store.get(task.id))?.points, 5);
});

test('an award that would overflow the table is refused', async () => {
  const { store, task } = await oneTask(2_147_483_647);
  await assert.rejects(awardPoints(store, task.id, 1, 'wavecenter'), /between/);
});

test('a missing task is reported, not silently skipped', async () => {
  const store = new MemoryTaskStore();
  await assert.rejects(setPoints(store, 'task-404', 1, 'wavecenter'), /No task task-404/);
});

test('if the points change between read and write, nothing is saved and it says so', async () => {
  const { store, task } = await oneTask(1);
  const realGet = store.get.bind(store);
  // Another change lands right after this one reads the points.
  store.get = async (id) => {
    const seen = await realGet(id);
    store.rows.set(id, { ...store.rows.get(id)!, points: 50 });
    return seen;
  };
  await assert.rejects(awardPoints(store, task.id, 2, 'wavecenter'), /changed while this change was being made/);
  assert.equal(store.rows.get(task.id)?.points, 50);
});
