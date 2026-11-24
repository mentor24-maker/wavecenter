import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertText, isOpenTaskFor, noAlerts, openTaskCount } from './alerts.ts';

const me = 'member-1';

test('open tasks are the member’s own todo and doing tasks', () => {
  assert.equal(isOpenTaskFor({ ownerId: me, status: 'todo' }, me), true);
  assert.equal(isOpenTaskFor({ ownerId: me, status: 'doing' }, me), true);
  assert.equal(isOpenTaskFor({ ownerId: me, status: 'proposed' }, me), false);
  assert.equal(isOpenTaskFor({ ownerId: me, status: 'done' }, me), false);
  assert.equal(isOpenTaskFor({ ownerId: 'someone-else', status: 'doing' }, me), false);
  assert.equal(isOpenTaskFor({ ownerId: '', status: 'todo' }, ''), false);
});

test('openTaskCount counts only the member’s open tasks', () => {
  const tasks = [
    { ownerId: me, status: 'todo' as const },
    { ownerId: me, status: 'doing' as const },
    { ownerId: me, status: 'done' as const },
    { ownerId: me, status: 'proposed' as const },
    { ownerId: 'other', status: 'todo' as const },
  ];
  assert.equal(openTaskCount(tasks, me), 2);
  assert.equal(openTaskCount([], me), 0);
});

test('alertText says the count in words, and ? when it could not be read', () => {
  assert.equal(alertText('messages', { ok: true, count: 1 }), '1 new message');
  assert.equal(alertText('messages', { ok: true, count: 4 }), '4 new messages');
  assert.equal(alertText('tasks', { ok: true, count: 1 }), '1 open task');
  assert.equal(alertText('tasks', { ok: true, count: 0 }), '0 open tasks');
  assert.equal(alertText('tasks', { ok: false, error: 'x' }), '? open tasks');
});

test('noAlerts only when both counts read and both are 0', () => {
  const zero = { ok: true as const, count: 0 };
  const failed = { ok: false as const, error: 'down' };
  assert.equal(noAlerts(zero, zero), true);
  assert.equal(noAlerts({ ok: true, count: 1 }, zero), false);
  assert.equal(noAlerts(zero, { ok: true, count: 2 }), false);
  assert.equal(noAlerts(failed, zero), false);
  assert.equal(noAlerts(zero, failed), false);
});
