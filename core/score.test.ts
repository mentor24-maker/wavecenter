import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFinishedTasks } from './score.ts';
import type { TaskStatus } from './tasks.ts';

const task = (status: TaskStatus, points: number) => ({ status, points });

test('no tasks: nothing finished and no points', () => {
  assert.deepEqual(scoreFinishedTasks([]), { total: 0, finished: 0 });
});

test('only unfinished tasks add nothing, whatever their points', () => {
  assert.deepEqual(scoreFinishedTasks([task('todo', 5), task('doing', 8)]), { total: 0, finished: 0 });
});

test('a mix: only the done tasks count', () => {
  assert.deepEqual(scoreFinishedTasks([task('done', 3), task('todo', 10), task('done', 5)]), { total: 8, finished: 2 });
});

test('a finished task worth zero points still counts as finished', () => {
  assert.deepEqual(scoreFinishedTasks([task('done', 0), task('done', 0), task('done', 4)]), { total: 4, finished: 3 });
});
