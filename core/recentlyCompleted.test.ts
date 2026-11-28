import test from 'node:test';
import assert from 'node:assert/strict';
import { RECENTLY_COMPLETED, completedDay, completedTaskFromRow, recentlyCompletedAccess } from './recentlyCompleted.ts';

test('Home and the module show the five most recently completed tasks (WC-265)', () => {
  assert.equal(RECENTLY_COMPLETED, 5);
});

test("a task's done date is its Mountain-time day", () => {
  assert.equal(completedDay('2026-11-27T18:00:00Z'), 'Nov 27, 2026');
  // 2am UTC on the 28th is still the evening of the 27th in Denver.
  assert.equal(completedDay('2026-11-28T02:00:00Z'), 'Nov 27, 2026');
});

test('no date, or one that cannot be read, shows no date rather than "Invalid Date"', () => {
  assert.equal(completedDay(null), '');
  assert.equal(completedDay(undefined), '');
  assert.equal(completedDay(''), '');
  assert.equal(completedDay('not a date'), '');
});

test('a completed task row is read into its three fields', () => {
  assert.deepEqual(completedTaskFromRow({ id: 't1', title: 'Write docs', completed_at: '2026-11-27T18:00:00Z', status: 'done' }), {
    id: 't1', title: 'Write docs', completedAt: '2026-11-27T18:00:00Z',
  });
  assert.deepEqual(completedTaskFromRow({ id: 't2', title: null, completed_at: null }), { id: 't2', title: '', completedAt: null });
});

test('a row with no id cannot be linked to, so it is left out', () => {
  for (const row of [null, undefined, 'x', 3, {}, { id: '' }, { id: 7, title: 'x' }]) assert.equal(completedTaskFromRow(row), null, String(row));
});

test('recently completed module: a failed sign-in check is never told to sign in', () => {
  assert.equal(recentlyCompletedAccess({ signedIn: false, checkFailed: true }, true), 'check-failed');
});

test('recently completed module: a signed-out visitor reads nothing', () => {
  assert.equal(recentlyCompletedAccess({ signedIn: false, checkFailed: false }, true), 'signed-out');
});

test('recently completed module: a signed-in member reads the tasks', () => {
  assert.equal(recentlyCompletedAccess({ signedIn: true, checkFailed: false }, true), 'read');
});

test('recently completed module: no database settings says so', () => {
  assert.equal(recentlyCompletedAccess({ signedIn: false, checkFailed: false }, false), 'no-database');
  assert.equal(recentlyCompletedAccess({ signedIn: true, checkFailed: false }, false), 'no-database');
});
