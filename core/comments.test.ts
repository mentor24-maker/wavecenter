import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addComment,
  checkCommentBody,
  commentAuthorKind,
  editComment,
  filterComments,
  MAX_COMMENT_LENGTH,
  NO_COMMENT_FILTER,
  removeComment,
} from './comments.ts';
import { createTask, deleteTask } from './tasks.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';
import { MemoryTaskCommentStore } from './memoryTaskCommentStore.ts';

async function setup() {
  const tasks = new MemoryTaskStore('dane');
  const comments = new MemoryTaskCommentStore('dane');
  // Deleting a task drops its comments, as the real table's cascade does.
  const remove = tasks.remove.bind(tasks);
  tasks.remove = async (id, tool) => {
    const gone = await remove(id, tool);
    if (gone) comments.dropRowsFor(id);
    return gone;
  };
  const task = await createTask(tasks, { title: 'Plan the launch' }, 'wavecenter');
  return { tasks, comments, task };
}

test('addComment posts a comment on a task, trimmed, naming its tool and owner', async () => {
  const { tasks, comments, task } = await setup();
  const c = await addComment(tasks, comments, task.id, '  First thoughts  ', 'wavecenter');
  assert.equal(c.taskId, task.id);
  assert.equal(c.body, 'First thoughts');
  assert.equal(c.ownerId, 'dane');
  assert.equal(c.tool, 'wavecenter');
  assert.equal(comments.rows.size, 1);
});

test('addComment refuses a blank or too-long comment, a missing tool, or a task the caller cannot see', async () => {
  const { tasks, comments, task } = await setup();
  await assert.rejects(addComment(tasks, comments, task.id, '   ', 'wavecenter'), /cannot be blank/);
  await assert.rejects(addComment(tasks, comments, task.id, 'x'.repeat(MAX_COMMENT_LENGTH + 1), 'wavecenter'), /at most 10,000/);
  await assert.rejects(addComment(tasks, comments, task.id, 'hello', ''), /must name the tool/);
  await assert.rejects(addComment(tasks, comments, 'task-elsewhere', 'hello', 'wavecenter'), /No task task-elsewhere .* comment on/);
  assert.equal(comments.rows.size, 0);
});

test('a failed save is reported, not swallowed', async () => {
  const { tasks, comments, task } = await setup();
  comments.failInsert = true;
  await assert.rejects(addComment(tasks, comments, task.id, 'hello', 'wavecenter'), /database is down/);
  assert.equal(comments.rows.size, 0);
});

test('checkCommentBody keeps markup as plain words; it is never treated as HTML', () => {
  assert.equal(checkCommentBody('<script>alert(1)</script>'), '<script>alert(1)</script>');
  assert.equal(checkCommentBody(`x`.repeat(MAX_COMMENT_LENGTH)).length, MAX_COMMENT_LENGTH);
  assert.throws(() => checkCommentBody(42), /cannot be blank/);
});

test('editComment changes the words and the tool; a missing comment is refused', async () => {
  const { tasks, comments, task } = await setup();
  const c = await addComment(tasks, comments, task.id, 'draft', 'wavecenter');
  const edited = await editComment(comments, c.id, ' final ', 'wavecenter');
  assert.equal(edited.body, 'final');
  await assert.rejects(editComment(comments, c.id, '  ', 'wavecenter'), /cannot be blank/);
  await assert.rejects(editComment(comments, 'comment-x', 'hi', 'wavecenter'), /No comment comment-x .* change/);
  assert.equal(comments.rows.get(c.id)?.body, 'final');
});

test('editComment never changes whether a comment counts as Human or AI', async () => {
  const { tasks, comments, task } = await setup();
  const fromAi = await addComment(tasks, comments, task.id, 'agent note', 'loop-build');
  const fromDane = await addComment(tasks, comments, task.id, 'my note', 'wavecenter');
  await assert.rejects(editComment(comments, fromAi.id, 'rewritten', 'wavecenter'), /written by AI, so it cannot be edited here/);
  await assert.rejects(editComment(comments, fromDane.id, 'rewritten', 'loop-build'), /an AI tool cannot edit it/);
  assert.equal((await editComment(comments, fromAi.id, 'agent note, updated', 'loop-build')).tool, 'loop-build');
  assert.equal(comments.rows.get(fromDane.id)?.body, 'my note');
});

test('removeComment removes one comment; a missing one is refused', async () => {
  const { tasks, comments, task } = await setup();
  const c = await addComment(tasks, comments, task.id, 'remove me', 'wavecenter');
  await assert.rejects(removeComment(comments, c.id, ''), /must name the tool/);
  await removeComment(comments, c.id, 'wavecenter');
  assert.equal(comments.rows.size, 0);
  await assert.rejects(removeComment(comments, c.id, 'wavecenter'), /No comment .* remove/);
});

test('another member cannot change or remove a comment that is not theirs', async () => {
  const { tasks, comments, task } = await setup();
  const c = await addComment(tasks, comments, task.id, 'mine', 'wavecenter');
  const other = new MemoryTaskCommentStore('someone-else');
  // Same rows, seen through another member's session.
  for (const [id, row] of comments.rows) other.rows.set(id, row);
  await assert.rejects(editComment(other, c.id, 'taken', 'wavecenter'), /No comment .* change/);
  await assert.rejects(removeComment(other, c.id, 'wavecenter'), /No comment .* remove/);
});

test('deleting a task deletes its comments', async () => {
  const { tasks, comments, task } = await setup();
  await addComment(tasks, comments, task.id, 'one', 'wavecenter');
  await addComment(tasks, comments, task.id, 'two', 'wavecenter');
  await deleteTask(tasks, task.id, 'wavecenter');
  assert.equal(comments.rows.size, 0);
});

test('commentAuthorKind: WaveCenter’s own app is a person, any other tool is AI', () => {
  assert.equal(commentAuthorKind({ tool: 'wavecenter' }), 'human');
  assert.equal(commentAuthorKind({ tool: 'loop-handoff' }), 'ai');
  assert.equal(commentAuthorKind({ tool: 'loop-build' }), 'ai');
});

test('filterComments narrows by every word typed and by author kind, oldest first', () => {
  const thread = [
    { body: 'Agent says the build passed', tool: 'loop-build', createdAt: '2026-10-27T03:00:00Z' },
    { body: 'Dane: ship the Logo today', tool: 'wavecenter', createdAt: '2026-10-27T01:00:00Z' },
    { body: 'Dane: logo is too dark', tool: 'wavecenter', createdAt: '2026-10-27T02:00:00Z' },
  ];
  assert.deepEqual(filterComments(thread, NO_COMMENT_FILTER).map((c) => c.createdAt), [
    '2026-10-27T01:00:00Z', '2026-10-27T02:00:00Z', '2026-10-27T03:00:00Z',
  ]);
  assert.equal(filterComments(thread, { text: 'LOGO', kind: 'both' }).length, 2);
  assert.equal(filterComments(thread, { text: 'logo dark', kind: 'both' }).length, 1);
  assert.equal(filterComments(thread, { text: '', kind: 'ai' })[0].tool, 'loop-build');
  assert.equal(filterComments(thread, { text: '', kind: 'human' }).length, 2);
  assert.equal(filterComments(thread, { text: 'logo', kind: 'ai' }).length, 0);
});

test('filterComments matches the words of a formatted comment, not its marks', () => {
  const thread = [{ body: 'Ship the **dark** [logo](https://example.com/logo) today\n- check *contrast*', tool: 'wavecenter', createdAt: '2026-10-28T01:00:00Z' }];
  assert.equal(filterComments(thread, { text: 'dark logo', kind: 'both' }).length, 1);
  assert.equal(filterComments(thread, { text: 'contrast', kind: 'both' }).length, 1);
  assert.equal(filterComments(thread, { text: '**dark**', kind: 'both' }).length, 0);
});
