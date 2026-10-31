import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, updateTask } from './tasks.ts';
import { CoreError } from './tool.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';
import { MemoryVoteStore } from './memoryVoteStore.ts';
import { averagePoints, averagePriority, castVote, requireNotVotedOn, summarizeVotes, votedValues } from './votes.ts';

async function setup() {
  const ledger = new MemoryEngagementStore();
  const tasks = new MemoryTaskStore('dane');
  const task = await createTask(tasks, { title: 'Plan the launch', points: 3, priority: 'normal' }, 'wavecenter', 'admin');
  const votes = new MemoryVoteStore(tasks, ledger);
  return { ledger, tasks, task, votes, dane: votes.as('dane'), second: votes.as('second') };
}

test('points average to the nearest whole number, a half rounding up', () => {
  assert.equal(averagePoints([]), null);
  assert.equal(averagePoints([8]), 8);
  assert.equal(averagePoints([8, 4]), 6);
  assert.equal(averagePoints([4, 5]), 5);
  assert.equal(averagePoints([1, 1, 2]), 1);
  assert.equal(averagePoints([0, 0]), 0);
});

test('priority averages as urgent 4, high 3, normal 2, low 1, rounded the same way', () => {
  assert.equal(averagePriority([]), null);
  assert.equal(averagePriority(['high', 'low']), 'normal');
  assert.equal(averagePriority(['high', 'normal']), 'high');
  assert.equal(averagePriority(['urgent', 'low']), 'high');
  assert.equal(averagePriority(['low', 'low', 'urgent']), 'normal');
  assert.equal(averagePriority(['urgent']), 'urgent');
});

test('a summary counts voters and each part on its own', () => {
  const summary = summarizeVotes([
    { points: 8, priority: null },
    { points: null, priority: 'high' },
    { points: 4, priority: 'low' },
  ]);
  assert.deepEqual(summary, { voters: 3, points: 6, pointsVotes: 2, priority: 'normal', priorityVotes: 2 });
  assert.deepEqual(summarizeVotes([]), { voters: 0, points: null, pointsVotes: 0, priority: null, priorityVotes: 0 });
});

test('votes change nothing on a done task, or when there are none', () => {
  const open = { status: 'todo' as const, points: 3, priority: 'normal' as const };
  assert.equal(votedValues(open, []), null);
  assert.equal(votedValues({ ...open, status: 'done' }, [{ points: 9, priority: 'urgent' }]), null);
  assert.deepEqual(votedValues(open, [{ points: 9, priority: null }]), { points: 9, priority: 'normal' }, 'an unvoted part keeps its value');
});

test('the average of every member’s votes becomes the task’s points and priority', async () => {
  const { tasks, task, dane, second } = await setup();
  await castVote(dane, task.id, { points: 8, priority: 'high' }, 'wavecenter');
  assert.deepEqual(summarizeVotes(await dane.forTask(task.id)), { voters: 1, points: 8, pointsVotes: 1, priority: 'high', priorityVotes: 1 });
  assert.equal((await tasks.get(task.id))?.points, 8);
  await castVote(second, task.id, { points: 4, priority: 'low' }, 'wavecenter');
  const stored = await tasks.get(task.id);
  assert.equal(stored?.points, 6);
  assert.equal(stored?.priority, 'normal');
});

test('voting again replaces the member’s vote; leaving a part out keeps it', async () => {
  const { task, dane } = await setup();
  await castVote(dane, task.id, { points: 8, priority: 'high' }, 'wavecenter');
  const changed = await castVote(dane, task.id, { points: 2 }, 'wavecenter');
  assert.equal(changed?.points, 2);
  assert.equal(changed?.priority, 'high');
  assert.equal((await dane.forTask(task.id)).length, 1, 'still one vote from this member');
});

test('a member can withdraw one part, or the whole vote', async () => {
  const { tasks, task, dane, second } = await setup();
  await castVote(dane, task.id, { points: 8, priority: 'high' }, 'wavecenter');
  await castVote(second, task.id, { points: 4 }, 'wavecenter');
  const left = await castVote(dane, task.id, { points: null }, 'wavecenter');
  assert.deepEqual([left?.points, left?.priority], [null, 'high']);
  assert.equal((await tasks.get(task.id))?.points, 4, 'the average is now the one points vote left');
  assert.equal(await castVote(dane, task.id, { priority: null }, 'wavecenter'), null);
  assert.equal(await dane.mine(task.id), null, 'nothing of the vote is left');
  assert.equal((await dane.forTask(task.id)).length, 1);
});

test('one member cannot change or withdraw another member’s vote', async () => {
  const { task, dane, second } = await setup();
  await castVote(dane, task.id, { points: 8 }, 'wavecenter');
  await castVote(second, task.id, { points: 1 }, 'wavecenter');
  await castVote(second, task.id, { points: null }, 'wavecenter');
  const left = await dane.forTask(task.id);
  assert.deepEqual(left.map((v) => [v.memberId, v.points]), [['dane', 8]], 'withdrawing only removed the second member’s own vote');
  assert.equal(await second.remove(task.id, 'wavecenter'), false, 'nothing of theirs left to remove');
});

test('votes on a done task are kept but do not change its locked points', async () => {
  const { tasks, task, dane } = await setup();
  await updateTask(tasks, task.id, { status: 'done' }, 'wavecenter');
  await castVote(dane, task.id, { points: 20, priority: 'urgent' }, 'wavecenter');
  const stored = await tasks.get(task.id);
  assert.deepEqual([stored?.points, stored?.priority], [3, 'normal']);
  assert.equal((await dane.forTask(task.id)).length, 1);
});

test('a vote must be valid and name its tool', async () => {
  const { task, dane } = await setup();
  await assert.rejects(castVote(dane, task.id, { points: -1 }, 'wavecenter'), /can't be negative/);
  await assert.rejects(castVote(dane, task.id, { points: 2.5 }, 'wavecenter'), /whole number/);
  await assert.rejects(castVote(dane, task.id, { priority: 'soon' as never }, 'wavecenter'), /priority must be one of/);
  await assert.rejects(castVote(dane, task.id, {}, 'wavecenter'), /points, a priority, or both/);
  await assert.rejects(castVote(dane, task.id, { points: 1 }, ''), /must name the tool/);
  await assert.rejects(castVote(dane, '', { points: 1 }, 'wavecenter'), CoreError);
  assert.equal(await dane.mine(task.id), null, 'nothing refused was saved');
});

test('every vote cast, changed or withdrawn is scored for the voter', async () => {
  const { ledger, task, second } = await setup();
  await castVote(second, task.id, { points: 4 }, 'wavecenter');
  await castVote(second, task.id, { priority: 'high' }, 'wavecenter');
  await castVote(second, task.id, { points: null, priority: null }, 'wavecenter');
  const votes = ledger.rows.filter((e) => e.kind === 'voted_on_task');
  assert.equal(votes.length, 3);
  for (const e of votes) assert.deepEqual([e.memberId, e.taskId, e.points], ['second', task.id, 1]);
});

test('a vote whose engagement cannot be written is not saved', async () => {
  const { ledger, task, dane } = await setup();
  ledger.failInsert = true;
  await assert.rejects(castVote(dane, task.id, { points: 4 }, 'wavecenter'), /ledger is down/);
  assert.equal(await dane.mine(task.id), null);
});

test('once members vote on a part, the owner cannot type over it', () => {
  assert.doesNotThrow(() => requireNotVotedOn([], 'points'));
  assert.doesNotThrow(() => requireNotVotedOn([{ points: null, priority: 'high' }], 'points'));
  assert.throws(() => requireNotVotedOn([{ points: 4, priority: null }], 'points'), /average of their votes/);
  assert.throws(() => requireNotVotedOn([{ points: null, priority: 'low' }], 'priority'), /its priority is the average/);
});
