import test from 'node:test';
import assert from 'node:assert/strict';
import { approveTask, createTask, deleteTask, updateTask, type Task } from './tasks.ts';
import { ROLES, memberPermissions, type RoleKey } from './members.ts';
import { CoreError } from './tool.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';

test('createTask fills in the defaults and records the tool', async () => {
  const store = new MemoryTaskStore('dane');
  const task = await createTask(store, { title: '  Buy milk ' }, 'wavecenter', 'admin');
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
  await assert.rejects(createTask(store, { title: 'x', points: -1 }, 'wavecenter'), /can't be negative; got -1/);
  assert.equal(store.rows.size, 0);
});

test('updateTask changes the record and stamps the tool that changed it', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Buy milk' }, 'wavecenter', 'admin');
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

test('a task added by anyone but an admin starts as proposed; an admin\'s starts as todo', async () => {
  const store = new MemoryTaskStore();
  for (const role of ['editor', 'contributor'] as const) {
    assert.equal((await createTask(store, { title: `By a ${role}` }, 'wavecenter', role)).status, 'proposed');
  }
  assert.equal((await createTask(store, { title: 'No role given' }, 'wavecenter')).status, 'proposed');
  assert.equal((await createTask(store, { title: 'By an admin' }, 'wavecenter', 'admin')).status, 'todo');
  await assert.rejects(createTask(store, { title: 'Skip the queue', status: 'todo' }, 'wavecenter', 'contributor'), /Only an admin/);
  assert.equal(store.rows.size, 4);
});

test('a proposed task keeps its status and cannot go to AI agents until it is approved', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Idea' }, 'wavecenter', 'contributor');
  await assert.rejects(updateTask(store, task.id, { status: 'done' }, 'wavecenter'), /still Proposed. An admin needs to approve it/);
  await assert.rejects(updateTask(store, task.id, { status: 'todo' }, 'wavecenter'), /still Proposed/);
  await assert.rejects(updateTask(store, task.id, { agentSelected: true }, 'wavecenter'), /cannot be handed to AI agents until an admin approves it/);
  const renamed = await updateTask(store, task.id, { title: 'Better idea', priority: 'high' }, 'wavecenter');
  assert.equal(renamed.status, 'proposed', 'other changes still save, and leave it proposed');
  assert.equal(renamed.agentSelected, false);
  const approved = await createTask(store, { title: 'Plan' }, 'wavecenter', 'admin');
  await assert.rejects(updateTask(store, approved.id, { status: 'proposed' }, 'wavecenter'), /only when it is added/);
});

test('only an admin approves a proposed task, which becomes todo; anyone else is refused and nothing changes', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Idea' }, 'wavecenter', 'contributor');
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer'] as const) {
    await assert.rejects(approveTask(store, task.id, role, 'wavecenter'), (err: Error) =>
      err instanceof CoreError && /Only an admin can approve/.test(err.message));
  }
  assert.equal((await store.get(task.id))?.status, 'proposed');
  await assert.rejects(approveTask(store, task.id, 'admin', ''), /must name the tool/);
  const approved = await approveTask(store, task.id, 'admin', 'wavecenter');
  assert.equal(approved.status, 'todo');
  assert.equal(approved.tool, 'wavecenter');
  await assert.rejects(approveTask(store, task.id, 'admin', 'wavecenter'), /no longer proposed/);
  await assert.rejects(approveTask(store, 'task-404', 'admin', 'wavecenter'), /no longer proposed/);
  const ticked = await updateTask(store, task.id, { agentSelected: true }, 'wavecenter');
  assert.equal(ticked.agentSelected, true, 'once approved it can go to AI agents');
});

test('an approval that does not land says so', async () => {
  const store = new MemoryTaskStore();
  const task = await createTask(store, { title: 'Idea' }, 'wavecenter', 'contributor');
  store.approve = async () => ({ ...(await store.get(task.id))! });
  await assert.rejects(approveTask(store, task.id, 'admin', 'wavecenter'), /did not save/);
});

test('approving a proposed task records one engagement, credited to the admin who approved it', async () => {
  const ledger = new MemoryEngagementStore();
  const store = new MemoryTaskStore('vee', ledger);
  const approvals = () => ledger.rows.filter((e) => e.kind === 'approved_a_proposed_task').map((e) => [e.memberId, e.points, e.tool, e.taskId]);
  const task = await createTask(store, { title: 'Idea' }, 'wavecenter', 'contributor');
  store.signedIn = 'dane';
  await approveTask(store, task.id, 'admin', 'approve-tool');
  assert.deepEqual(approvals(), [['dane', 1, 'approve-tool', task.id]]);
  // The owner's own record of the change stays as it was: one "Changed a task".
  assert.deepEqual(ledger.rows.filter((e) => e.memberId === 'vee').map((e) => e.kind), ['made_task', 'changed_task']);

  // Refused, already approved, or not a proposed task at all: nothing is recorded.
  const other = await createTask(store, { title: 'Another idea' }, 'wavecenter', 'contributor');
  store.signedIn = 'eddie';
  await assert.rejects(approveTask(store, other.id, 'editor', 'wavecenter'), /Only an admin/);
  store.signedIn = 'dane';
  await assert.rejects(approveTask(store, task.id, 'admin', 'wavecenter'), /no longer proposed/);
  await assert.rejects(approveTask(store, 'task-404', 'admin', 'wavecenter'), /no longer proposed/);
  const added = await createTask(store, { title: 'An admin task' }, 'wavecenter', 'admin');
  await updateTask(store, added.id, { status: 'doing' }, 'wavecenter');
  assert.equal(approvals().length, 1);

  // If the engagement cannot be written, the task is not approved either.
  ledger.failInsert = true;
  await assert.rejects(approveTask(store, other.id, 'admin', 'wavecenter'), /ledger is down/);
  assert.equal((await store.get(other.id))?.status, 'proposed');
});

// What each role may do on tasks (Dane, 2026-11-26, WC-248): an editor or
// admin changes and deletes anyone's task, a reviewer or viewer cannot add
// tasks, and a contributor keeps changing only their own.
const MAY: Record<RoleKey, { add: boolean; editOwn: boolean; editOther: boolean; deleteOwn: boolean; deleteOther: boolean }> = {
  admin: { add: true, editOwn: true, editOther: true, deleteOwn: true, deleteOther: true },
  editor: { add: true, editOwn: true, editOther: true, deleteOwn: true, deleteOther: true },
  contributor: { add: true, editOwn: true, editOther: false, deleteOwn: true, deleteOther: false },
  reviewer: { add: false, editOwn: false, editOther: false, deleteOwn: false, deleteOther: false },
  viewer: { add: false, editOwn: false, editOther: false, deleteOwn: false, deleteOther: false },
};

/** A store for `me`, holding one task of their own and one of another member's. */
function twoOwners(me = 'me') {
  const store = new MemoryTaskStore(me);
  const at = new Date().toISOString();
  const row = (id: string, ownerId: string): Task => ({
    id, title: `Task ${id}`, notes: null, ownerId, status: 'todo', parentTaskId: null, points: 0, ownerPoints: null,
    position: 0, priority: 'normal', agentSelected: false, agentTicketUrl: null, tool: 'seed', createdAt: at, updatedAt: at, completedAt: null,
  });
  store.rows.set('mine', row('mine', me));
  store.rows.set('theirs', row('theirs', 'someone-else'));
  return store;
}

for (const { key: role } of ROLES) {
  const may = MAY[role];
  const permissions = memberPermissions(role);
  const a = role === 'admin' || role === 'editor' ? 'an' : 'a';

  test(`${a} ${role} ${may.add ? 'adds' : 'may not add'} a task`, async () => {
    const store = twoOwners();
    const adding = createTask(store, { title: 'New' }, 'wavecenter', role, permissions);
    if (may.add) assert.equal((await adding).title, 'New');
    else {
      await assert.rejects(adding, /Your role may not add tasks. Nothing was added./);
      assert.equal(store.rows.size, 2, 'nothing was added');
    }
  });

  for (const [which, id, allowed] of [['their own', 'mine', may.editOwn], ["another member's", 'theirs', may.editOther]] as const) {
    test(`${a} ${role} ${allowed ? 'changes' : 'may not change'} ${which} task`, async () => {
      const store = twoOwners();
      const editing = updateTask(store, id, { title: 'Renamed' }, 'wavecenter', permissions);
      if (allowed) assert.equal((await editing).title, 'Renamed');
      else {
        await assert.rejects(editing, CoreError);
        await assert.rejects(updateTask(store, id, { title: 'Renamed' }, 'wavecenter', permissions), /Your role may (not change tasks|change only your own tasks)/);
        assert.equal(store.rows.get(id)!.title, `Task ${id}`, 'nothing changed');
      }
    });
  }

  for (const [which, id, allowed] of [['their own', 'mine', may.deleteOwn], ["another member's", 'theirs', may.deleteOther]] as const) {
    test(`${a} ${role} ${allowed ? 'deletes' : 'may not delete'} ${which} task`, async () => {
      const store = twoOwners();
      const deleting = deleteTask(store, id, 'wavecenter', permissions);
      if (allowed) {
        await deleting;
        assert.equal(store.rows.has(id), false);
      } else {
        await assert.rejects(deleting, /Your role may (not delete tasks|delete only your own tasks)/);
        assert.equal(store.rows.has(id), true, 'nothing was deleted');
      }
    });
  }
}

test("the refusals say why in plain words: a contributor is told the task is another member's, a viewer that their role may not", async () => {
  const store = twoOwners();
  await assert.rejects(updateTask(store, 'theirs', { title: 'x' }, 'wavecenter', memberPermissions('contributor')),
    /Your role may change only your own tasks, and this one is another member's. Nothing was changed./);
  await assert.rejects(updateTask(store, 'mine', { title: 'x' }, 'wavecenter', memberPermissions('viewer')), /Your role may not change tasks. Nothing was changed./);
  await assert.rejects(deleteTask(store, 'theirs', 'wavecenter', memberPermissions('contributor')), /Your role may delete only your own tasks/);
  await assert.rejects(updateTask(store, 'nope', { title: 'x' }, 'wavecenter', memberPermissions('admin')), /No task nope was found that you may change/);
  await assert.rejects(deleteTask(store, 'nope', 'wavecenter', memberPermissions('admin')), /No task nope was found that you may delete/);
});

test('a caller that names no permissions may do what a contributor may: change and delete their own task, not anyone else\'s', async () => {
  const store = twoOwners();
  assert.equal((await updateTask(store, 'mine', { title: 'Mine still' }, 'wavecenter')).title, 'Mine still');
  await assert.rejects(updateTask(store, 'theirs', { title: 'x' }, 'wavecenter'), /only your own tasks/);
  await assert.rejects(deleteTask(store, 'theirs', 'wavecenter'), /only your own tasks/);
  await deleteTask(store, 'mine', 'wavecenter');
  assert.equal(store.rows.has('mine'), false);
});

test("an editor moves another member's task only under one of that member's tasks", async () => {
  const store = twoOwners();
  const at = new Date().toISOString();
  store.rows.set('their-parent', { ...store.rows.get('theirs')!, id: 'their-parent', title: 'Their parent', createdAt: at });
  const editor = memberPermissions('editor');
  await assert.rejects(updateTask(store, 'theirs', { parentTaskId: 'mine' }, 'wavecenter', editor), /No task mine was found that you may put this task under/);
  assert.equal((await updateTask(store, 'theirs', { parentTaskId: 'their-parent' }, 'wavecenter', editor)).parentTaskId, 'their-parent');
  await assert.rejects(updateTask(store, 'mine', { parentTaskId: 'their-parent' }, 'wavecenter', editor), /that you may put this task under/);
});
