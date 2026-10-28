import test from 'node:test';
import assert from 'node:assert/strict';
import { addComment } from './comments.ts';
import {
  attachFile,
  checkFile,
  commentFilePath,
  deleteTaskWithFiles,
  filePath,
  isImage,
  MAX_FILE_BYTES,
  removeCommentWithFiles,
  removeFile,
} from './files.ts';
import { createTask } from './tasks.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';
import { MemoryTaskCommentStore } from './memoryTaskCommentStore.ts';
import { MemoryTaskFileStore } from './memoryTaskFileStore.ts';

async function setup() {
  const tasks = new MemoryTaskStore('dane');
  const files = new MemoryTaskFileStore('dane');
  // Deleting a task drops its file rows, as the real table's cascade does.
  const remove = tasks.remove.bind(tasks);
  tasks.remove = async (id, tool) => {
    const gone = await remove(id, tool);
    if (gone) files.dropRowsFor(id);
    return gone;
  };
  const task = await createTask(tasks, { title: 'Add the logo' }, 'wavecenter');
  /** Store a copy the way a browser upload would, and say what was stored. */
  const upload = (name: string, sizeBytes = 100, taskId = task.id) => {
    const path = filePath('dane', taskId, `r${files.objects.size + 1}`, name);
    files.objects.add(path);
    return { taskId, path, name, sizeBytes, contentType: 'image/png' };
  };
  return { tasks, files, task, upload };
}

test('attachFile records a stored file on a task and names the tool', async () => {
  const { tasks, files, task, upload } = await setup();
  const file = await attachFile(tasks, files, upload(' logo.png '), 'wavecenter');
  assert.equal(file.taskId, task.id);
  assert.equal(file.name, 'logo.png');
  assert.equal(file.ownerId, 'dane');
  assert.equal(file.tool, 'wavecenter');
  assert.equal(files.rows.size, 1);
  assert.equal(files.objects.size, 1);
});

test('checkFile refuses a blank name and anything over 10 MB, in plain words', () => {
  assert.equal(checkFile(' a.png ', MAX_FILE_BYTES), 'a.png');
  assert.throws(() => checkFile('  ', 10), /needs a name/);
  assert.throws(() => checkFile('big.mov', MAX_FILE_BYTES + 1), /"big.mov" is 10.0 MB, and files can be at most 10 MB/);
  assert.throws(() => checkFile('x', -1), /whole number of bytes/);
});

test('attachFile refuses a missing tool, a big file or another task, and deletes the stored copy', async () => {
  const { tasks, files, upload } = await setup();
  await assert.rejects(attachFile(tasks, files, upload('a.png'), ''), /must name the tool/);
  await assert.rejects(attachFile(tasks, files, upload('b.png', MAX_FILE_BYTES + 1), 'wavecenter'), /at most 10 MB/);
  await assert.rejects(attachFile(tasks, files, upload('c.png', 1, 'task-elsewhere'), 'wavecenter'), /No task task-elsewhere/);
  assert.equal(files.rows.size, 0);
  assert.equal(files.objects.size, 0, 'no stored copy is left behind');
});

test('attachFile refuses a path outside the task folder and leaves that path alone', async () => {
  const { tasks, files, task } = await setup();
  files.objects.add('dane/other-task/r1-keep.png');
  await assert.rejects(
    attachFile(tasks, files, { taskId: task.id, path: 'dane/other-task/r1-keep.png', name: 'keep.png', sizeBytes: 1 }, 'wavecenter'),
    /this task's own folder/,
  );
  assert.ok(files.objects.has('dane/other-task/r1-keep.png'));
});

test('a failed save deletes the stored copy again and says so', async () => {
  const { tasks, files, upload } = await setup();
  files.failInsert = true;
  await assert.rejects(attachFile(tasks, files, upload('logo.png'), 'wavecenter'), /the database is down/);
  assert.equal(files.rows.size, 0);
  assert.equal(files.objects.size, 0);
});

test('removeFile deletes the stored copy and the row', async () => {
  const { tasks, files, upload } = await setup();
  const file = await attachFile(tasks, files, upload('logo.png'), 'wavecenter');
  await removeFile(files, file.id, 'wavecenter');
  assert.equal(files.rows.size, 0);
  assert.equal(files.objects.size, 0);
  await assert.rejects(removeFile(files, file.id, 'wavecenter'), /No file .* you may remove/);
  await assert.rejects(removeFile(files, 'x', ' '), /must name the tool/);
});

test('when storage fails, removeFile keeps the row so it can be removed again', async () => {
  const { tasks, files, upload } = await setup();
  const file = await attachFile(tasks, files, upload('logo.png'), 'wavecenter');
  files.failDeleteObjects = true;
  await assert.rejects(removeFile(files, file.id, 'wavecenter'), /storage is down/);
  assert.equal(files.rows.size, 1);
  files.failDeleteObjects = false;
  await removeFile(files, file.id, 'wavecenter');
  assert.equal(files.objects.size, 0);
});

test('deleteTaskWithFiles deletes the stored copies, not just the rows', async () => {
  const { tasks, files, task, upload } = await setup();
  const other = await createTask(tasks, { title: 'Other' }, 'wavecenter');
  await attachFile(tasks, files, upload('a.png'), 'wavecenter');
  await attachFile(tasks, files, upload('b.pdf'), 'wavecenter');
  const kept = await attachFile(tasks, files, upload('c.png', 1, other.id), 'wavecenter');
  await deleteTaskWithFiles(tasks, files, task.id, 'wavecenter');
  assert.equal(await tasks.get(task.id), null);
  assert.deepEqual([...files.objects], [kept.path]);
  assert.deepEqual([...files.rows.keys()], [kept.id]);
});

test('when storage fails, deleteTaskWithFiles keeps the task to delete again', async () => {
  const { tasks, files, task, upload } = await setup();
  await attachFile(tasks, files, upload('a.png'), 'wavecenter');
  files.failDeleteObjects = true;
  await assert.rejects(deleteTaskWithFiles(tasks, files, task.id, 'wavecenter'), /storage is down/);
  assert.ok(await tasks.get(task.id));
  await assert.rejects(deleteTaskWithFiles(tasks, files, 'nope', 'wavecenter'), /No task nope .* you may delete/);
});

test('filePath keeps the name inside the task folder', () => {
  assert.equal(filePath('o', 't', 'r', 'logo.png'), 'o/t/r-logo.png');
  assert.equal(filePath('o', 't', 'r', '../../x/y z.svg'), 'o/t/r-__.._x_y_z.svg');
  assert.ok(isImage('image/SVG+xml'));
  assert.ok(!isImage('application/pdf'));
  assert.ok(!isImage(null));
});

/** A task with a comment on it, and a way to "upload" a file for that comment. */
async function commentSetup() {
  const base = await setup();
  const comments = new MemoryTaskCommentStore('dane');
  // Deleting a task or a comment drops what hangs off it, as the real tables' cascades do.
  const removeTask = base.tasks.remove.bind(base.tasks);
  base.tasks.remove = async (id, tool) => {
    const gone = await removeTask(id, tool);
    if (gone) comments.dropRowsFor(id);
    return gone;
  };
  const removeComment = comments.remove.bind(comments);
  comments.remove = async (id) => {
    const gone = await removeComment(id);
    if (gone) for (const [fileId, f] of base.files.rows) if (f.commentId === id) base.files.rows.delete(fileId);
    return gone;
  };
  const comment = await addComment(base.tasks, comments, base.task.id, 'Here is the mock-up', 'wavecenter');
  const uploadForComment = (name: string, commentId = comment.id, taskId = base.task.id) => {
    const path = commentFilePath('dane', taskId, `r${base.files.objects.size + 1}`, name);
    base.files.objects.add(path);
    return { taskId, path, name, sizeBytes: 100, contentType: 'image/png', commentId };
  };
  return { ...base, comments, comment, uploadForComment };
}

test('attachFile puts a file on a Discussion comment, stored in the comments folder', async () => {
  const { tasks, files, comments, comment, uploadForComment } = await commentSetup();
  const file = await attachFile(tasks, files, uploadForComment('mock.png'), 'wavecenter', comments);
  assert.equal(file.commentId, comment.id);
  assert.match(file.path, /^dane\/[^/]+\/comments\/r1-mock\.png$/);
});

test('a task file has no comment', async () => {
  const { tasks, files, upload } = await setup();
  assert.equal((await attachFile(tasks, files, upload('logo.png'), 'wavecenter')).commentId, null);
});

test('attachFile refuses an unknown comment, one on another task, or the wrong folder, and deletes the stored copy', async () => {
  const { tasks, files, comments, task, upload, uploadForComment } = await commentSetup();
  await assert.rejects(attachFile(tasks, files, uploadForComment('a.png', 'comment-x'), 'wavecenter', comments), /No comment comment-x/);
  const other = await createTask(tasks, { title: 'Other' }, 'wavecenter');
  const elsewhere = await addComment(tasks, comments, other.id, 'Elsewhere', 'wavecenter');
  await assert.rejects(attachFile(tasks, files, uploadForComment('b.png', elsewhere.id), 'wavecenter', comments), /No comment .* on this task/);
  await assert.rejects(attachFile(tasks, files, uploadForComment('c.png'), 'wavecenter'), /No comment/, 'no comment store, no comment file');
  const { commentId } = uploadForComment('d.png');
  await assert.rejects(
    attachFile(tasks, files, { ...upload('d.png'), commentId }, 'wavecenter', comments),
    /not stored in this task's comments folder/,
  );
  const { commentId: _, ...asTaskFile } = uploadForComment('e.png');
  await assert.rejects(attachFile(tasks, files, asTaskFile, 'wavecenter', comments), /stored for a comment/);
  assert.equal(files.rows.size, 0);
  assert.equal(files.objects.size, 1, 'only the one stored for "d.png" under the comments folder remains, never sent to attach');
  assert.ok(await tasks.get(task.id));
});

test('removeCommentWithFiles deletes the comment, its stored copies and its rows, and leaves other files alone', async () => {
  const { tasks, files, comments, comment, upload, uploadForComment } = await commentSetup();
  await attachFile(tasks, files, uploadForComment('a.png'), 'wavecenter', comments);
  await attachFile(tasks, files, uploadForComment('b.pdf'), 'wavecenter', comments);
  const taskFile = await attachFile(tasks, files, upload('logo.png'), 'wavecenter');
  await removeCommentWithFiles(comments, files, comment.id, 'wavecenter');
  assert.equal(await comments.get(comment.id), null);
  assert.deepEqual([...files.objects], [taskFile.path]);
  assert.deepEqual([...files.rows.keys()], [taskFile.id]);
  await assert.rejects(removeCommentWithFiles(comments, files, comment.id, 'wavecenter'), /No comment .* you may remove/);
});

test('when storage fails, removeCommentWithFiles keeps the comment and its files to remove again', async () => {
  const { tasks, files, comments, comment, uploadForComment } = await commentSetup();
  await attachFile(tasks, files, uploadForComment('a.png'), 'wavecenter', comments);
  files.failDeleteObjects = true;
  await assert.rejects(removeCommentWithFiles(comments, files, comment.id, 'wavecenter'), /storage is down/);
  assert.ok(await comments.get(comment.id));
  assert.equal(files.rows.size, 1);
});

test('deleteTaskWithFiles deletes the comments\' stored files too', async () => {
  const { tasks, files, comments, task, upload, uploadForComment } = await commentSetup();
  await attachFile(tasks, files, upload('logo.png'), 'wavecenter');
  await attachFile(tasks, files, uploadForComment('mock.png'), 'wavecenter', comments);
  await deleteTaskWithFiles(tasks, files, task.id, 'wavecenter');
  assert.equal(files.objects.size, 0);
  assert.equal(files.rows.size, 0);
  assert.equal(comments.rows.size, 0);
});

test('commentFilePath keeps the name inside the task\'s comments folder', () => {
  assert.equal(commentFilePath('o', 't', 'r', '../x.png'), 'o/t/comments/r-__x.png');
});
