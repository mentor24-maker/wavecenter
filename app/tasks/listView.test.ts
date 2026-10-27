import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks, isFiltering, matches, nextSort, NO_FILTER, sortTasks, type ViewTask } from './listView.ts';

function task(id: string, over: Partial<ViewTask> = {}): ViewTask {
  return {
    id,
    title: id,
    notes: null,
    status: 'todo',
    points: 0,
    parentTaskId: null,
    priority: 'normal',
    agentSelected: false,
    agentTicketUrl: null,
    ownerId: 'dane',
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const ids = (list: ViewTask[]) => list.map((t) => t.id);

test('no sort keeps the saved order', () => {
  const list = [task('b'), task('a')];
  assert.deepEqual(ids(sortTasks(list, null)), ['b', 'a']);
});

test('a first click sorts each column its natural way, a second click reverses it', () => {
  assert.deepEqual(nextSort(null, 'title'), { key: 'title', ascending: true });
  assert.deepEqual(nextSort(null, 'points'), { key: 'points', ascending: false });
  assert.deepEqual(nextSort({ key: 'title', ascending: true }, 'title'), { key: 'title', ascending: false });
  assert.deepEqual(nextSort({ key: 'title', ascending: false }, 'priority'), { key: 'priority', ascending: true });
});

test('priority sorts Urgent, High, Normal, Low, and back', () => {
  const list = [task('n'), task('l', { priority: 'low' }), task('u', { priority: 'urgent' }), task('h', { priority: 'high' })];
  assert.deepEqual(ids(sortTasks(list, { key: 'priority', ascending: true })), ['u', 'h', 'n', 'l']);
  assert.deepEqual(ids(sortTasks(list, { key: 'priority', ascending: false })), ['l', 'n', 'h', 'u']);
});

test('title sorts ignoring capitals and with numbers in number order', () => {
  const list = [task('1', { title: 'task 10' }), task('2', { title: 'Task 2' }), task('3', { title: 'apple' })];
  assert.deepEqual(ids(sortTasks(list, { key: 'title', ascending: true })), ['3', '2', '1']);
});

test('points and created sort, and ties keep the saved order', () => {
  const list = [
    task('a', { points: 3, createdAt: '2026-10-02T00:00:00Z' }),
    task('b', { points: 5, createdAt: '2026-10-01T00:00:00Z' }),
    task('c', { points: 3, createdAt: '2026-10-03T00:00:00Z' }),
  ];
  assert.deepEqual(ids(sortTasks(list, { key: 'points', ascending: false })), ['b', 'a', 'c']);
  assert.deepEqual(ids(sortTasks(list, { key: 'created', ascending: false })), ['c', 'a', 'b']);
});

test('no filter shows everything', () => {
  const list = [task('a'), task('b')];
  assert.equal(isFiltering(NO_FILTER), false);
  assert.deepEqual(ids(filterTasks(list, NO_FILTER).shown), ['a', 'b']);
});

test('text matches title or details, ignoring capitals', () => {
  assert.equal(matches(task('a', { title: 'Buy MILK' }), { ...NO_FILTER, text: 'milk' }), true);
  assert.equal(matches(task('a', { notes: 'from the Corner shop' }), { ...NO_FILTER, text: 'corner' }), true);
  assert.equal(matches(task('a'), { ...NO_FILTER, text: 'zzzz' }), false);
  assert.equal(matches(task('a'), { ...NO_FILTER, text: '   ' }), true);
});

test('priority, status, points and creator each narrow, and they combine', () => {
  const t = task('a', { priority: 'high', points: 5, ownerId: 'dane', agentSelected: true });
  assert.equal(matches(t, { ...NO_FILTER, priority: 'high' }), true);
  assert.equal(matches(t, { ...NO_FILTER, priority: 'low' }), false);
  assert.equal(matches(t, { ...NO_FILTER, status: 'open' }), true);
  assert.equal(matches(t, { ...NO_FILTER, status: 'done' }), false);
  assert.equal(matches(t, { ...NO_FILTER, status: 'ticked' }), true);
  assert.equal(matches(t, { ...NO_FILTER, status: 'with-agents' }), false);
  assert.equal(matches(task('x', { agentTicketUrl: 'https://x' }), { ...NO_FILTER, status: 'with-agents' }), true);
  assert.equal(matches(t, { ...NO_FILTER, minPoints: '5', maxPoints: '5' }), true);
  assert.equal(matches(t, { ...NO_FILTER, minPoints: '6' }), false);
  assert.equal(matches(t, { ...NO_FILTER, maxPoints: '4' }), false);
  assert.equal(matches(t, { ...NO_FILTER, creator: 'dane' }), true);
  assert.equal(matches(t, { ...NO_FILTER, creator: 'someone-else' }), false);
  assert.equal(matches(t, { ...NO_FILTER, priority: 'high', minPoints: '6' }), false);
});

test('a matching sub-task keeps its parent visible, marked as context only', () => {
  const list = [task('p', { title: 'Plan' }), task('c', { title: 'Write milk list', parentTaskId: 'p' }), task('o', { title: 'Other' })];
  const { shown, contextOnly } = filterTasks(list, { ...NO_FILTER, text: 'milk' });
  assert.deepEqual(ids(shown), ['p', 'c']);
  assert.deepEqual([...contextOnly], ['p']);
});

test('a loop of parents does not hang the filter', () => {
  const list = [task('a', { parentTaskId: 'b' }), task('b', { parentTaskId: 'a', title: 'match' })];
  assert.deepEqual(ids(filterTasks(list, { ...NO_FILTER, text: 'match' }).shown), ['a', 'b']);
});
