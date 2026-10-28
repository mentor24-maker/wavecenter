import test from 'node:test';
import assert from 'node:assert/strict';
import { restTaskStore, toRow } from './restTaskStore.mjs';
import { createTask } from '../../core/tasks.ts';
import { setPoints } from '../../core/points.ts';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization, headers: init.headers });
    const next = responses.shift();
    return { ok: next.status < 300, status: next.status, text: async () => JSON.stringify(next.body) };
  };
  return { fn, calls };
}

const row = { id: 't1', title: 'Buy milk', notes: null, owner_id: 'u1', status: 'todo', parent_task_id: null,
  points: 0, position: 0, tool: 'wavecenter', created_at: 'c', updated_at: 'u', completed_at: null };

test('core writes reach the table under the table\'s own column names, with the member\'s token', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: [{ ...row, id: 'p1' }] }, { status: 201, body: [row] }]);
  const store = restTaskStore({ url: 'https://x.supabase.co', apiKey: 'anon', token: 'member-token', fetch: fn });
  const task = await createTask(store, { title: 'Buy milk', parentTaskId: 'p1' }, 'check');
  assert.match(calls[0].url, /tasks\?id=eq\.p1&select=\*$/, 'core first checks the parent is one the member can see');
  assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/tasks');
  assert.equal(calls[1].auth, 'Bearer member-token');
  assert.equal(calls[1].body.parent_task_id, 'p1');
  assert.equal(calls[1].body.tool, 'check');
  assert.equal(task.ownerId, 'u1');
});

test('a points change only writes if the points and status are still what core read', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: [row] }, { status: 200, body: [] }]);
  const store = restTaskStore({ url: 'https://x.supabase.co', apiKey: 'anon', token: 't', fetch: fn });
  await assert.rejects(setPoints(store, 't1', 5, 'check'), /changed while this change was being made/);
  assert.equal(calls[1].method, 'PATCH');
  assert.match(calls[1].url, /id=eq\.t1&points=eq\.0&status=eq\.todo$/);
  assert.deepEqual(calls[1].body, { points: 5, tool: 'check' });
});

test('a failed write throws instead of pretending it worked', async () => {
  const { fn } = fakeFetch([{ status: 403, body: { message: 'row-level security' } }]);
  const store = restTaskStore({ url: 'https://x.supabase.co', apiKey: 'anon', token: 't', fetch: fn });
  await assert.rejects(createTask(store, { title: 'x' }, 'check'), /HTTP 403/);
});

test('a delete says whether a row was actually deleted', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: [row] }, { status: 200, body: [] }]);
  const store = restTaskStore({ url: 'https://x.supabase.co', apiKey: 'anon', token: 't', fetch: fn });
  assert.equal(await store.remove('t1', 'check'), true);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].headers['x-wavecenter-tool'], 'check', 'the delete names its tool for the ledger');
  assert.match(calls[0].url, /tasks\?id=eq\.t1$/);
  assert.equal(await store.remove('t1', 'check'), false, 'nothing deleted (gone, or not yours) is not reported as a success');
});

test('an unknown field is refused rather than sent', () => {
  assert.throws(() => toRow({ owner_id: 'someone' }), /no column/);
});

test('given a member, get asks only for that member’s own task', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: [] }, { status: 200, body: [row] }]);
  const mine = restTaskStore({ url: 'https://x.supabase.co', apiKey: 'anon', token: 't', ownerId: 'u1', fetch: fn });
  assert.equal(await mine.get('t1'), null);
  assert.match(calls[0].url, /tasks\?id=eq\.t1&owner_id=eq\.u1&select=\*$/);
  const any = restTaskStore({ url: 'https://x.supabase.co', apiKey: 'service', token: 'service', fetch: fn });
  await any.get('t1');
  assert.match(calls[1].url, /tasks\?id=eq\.t1&select=\*$/, 'the service-key lane still reads any task');
});
