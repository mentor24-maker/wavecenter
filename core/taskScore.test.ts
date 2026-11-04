import test from 'node:test';
import assert from 'node:assert/strict';
import { setPoints } from './points.ts';
import { createTask, updateTask } from './tasks.ts';
import { MemoryAiTaskRatingStore } from './memoryAiTaskRatingStore.ts';
import { MemoryTaskStore } from './memoryTaskStore.ts';
import { MemoryVoteStore } from './memoryVoteStore.ts';
import { recordAiTaskRating, type TaskFactors } from './taskFactors.ts';
import { FINAL_SCORE_EXAMPLES, finalScore, othersScore, taskScore, taskScoreLine } from './taskScore.ts';
import { castVote } from './votes.ts';

const reasons = { scope: 'One screen.', difficulty: 'Well known.', relevance: 'Members use it.', demand: 'Wanted soon.' };

async function setup(points = 10) {
  const tasks = new MemoryTaskStore('dane');
  const ratings = new MemoryAiTaskRatingStore(tasks);
  const votes = new MemoryVoteStore(tasks);
  const task = await createTask(tasks, { title: 'Plan the launch', points }, 'wavecenter', 'admin');
  const rate = (factors: TaskFactors) =>
    recordAiTaskRating(ratings, { taskId: task.id, models: [{ model: 'claude-opus-5-5', factors, reasons }], instructionVersion: 'v1', fingerprint: 'sha256:x', tool: 'ai-rater' });
  return { tasks, ratings, votes, task, rate };
}

// 3 × 2 × (5 + 5) ÷ 5 = 12.
const TWELVE: TaskFactors = { scope: 3, difficulty: 2, relevance: 5, demand: 5 };

test('the final score is the average of the AI score and the owner’s, a half rounding up, as in the design’s worked examples', () => {
  for (const { task, parts, final } of FINAL_SCORE_EXAMPLES) assert.equal(finalScore(parts), final, task);
});

test('a part the task does not have yet is left out; with none at all the final score is 0', () => {
  assert.equal(finalScore({ ai: null, owner: 10, others: null }), 10);
  assert.equal(finalScore({ ai: 12, owner: null, others: null }), 12, 'an owner’s 0 is "not set", so the AI score stands alone');
  assert.equal(finalScore({ ai: null, owner: 10, others: 13 }), 12, '11.5 rounds up');
  assert.equal(finalScore({ ai: null, owner: null, others: null }), 0);
  assert.equal(finalScore({ ai: 1, owner: 1, others: 2 }), 1, '1.33 rounds down');
});

test('the others’ score is every other member’s points vote, averaged; the owner’s own vote and priority-only votes are not in it', () => {
  const votes = [
    { memberId: 'dane', points: 50 },
    { memberId: 'a', points: 15 },
    { memberId: 'b', points: 20 },
    { memberId: 'c', points: 25 },
    { memberId: 'd', points: null },
  ];
  assert.deepEqual(othersScore('dane', votes), { score: 20, votes: 3 });
  assert.deepEqual(othersScore('dane', [{ memberId: 'dane', points: 9 }]), { score: null, votes: 0 });
  assert.deepEqual(othersScore('dane', [{ memberId: 'a', points: 4 }, { memberId: 'b', points: 5 }]), { score: 5, votes: 2 });
});

test('the task page’s line says how the points were reached, and says plainly when the AI has not rated it', () => {
  const open = { ownerId: 'dane', ownerPoints: 10, status: 'todo' as const, points: 11 };
  assert.equal(taskScoreLine(taskScore(open, 12, [])), 'AI 12, owner 10, final 11');
  assert.equal(taskScoreLine(taskScore(open, null, [])), 'AI: not yet, owner 10, final 10 (provisional until the AI rates it)');
  assert.equal(taskScoreLine(taskScore({ ...open, ownerPoints: null }, null, [{ memberId: 'a', points: 7 }])),
    'AI: not yet, owner: not set, others 7 (1 vote), final 7 (provisional until the AI rates it)');
  const done = taskScore({ ...open, status: 'done', points: 9 }, 12, []);
  assert.deepEqual([done.points, done.final, done.locked], [9, 11, true]);
  assert.equal(taskScoreLine(done), 'AI 12, owner 10, final 11. The task is done, so its points stay locked at 9');
});

test('an AI rating sets the task’s points to the average of the AI score and the owner’s', async () => {
  const { tasks, task, rate } = await setup(10);
  assert.equal((await tasks.get(task.id))?.points, 10, 'before the AI rates it, the owner’s score stands');
  await rate(TWELVE);
  const stored = await tasks.get(task.id);
  assert.deepEqual([stored?.points, stored?.ownerPoints, stored?.tool], [11, 10, 'ai-rater']);
  await rate({ scope: 1, difficulty: 1, relevance: 1, demand: 1 });
  assert.equal((await tasks.get(task.id))?.points, 6, 'the newest rating counts: AI 1 and owner 10 make 5.5, so 6');
});

test('the owner changing their score moves the final score, even to the number already shown', async () => {
  const { tasks, task, rate } = await setup(10);
  await rate(TWELVE);
  const change = await setPoints(tasks, task.id, 20, 'wavecenter');
  assert.deepEqual([change.task.ownerPoints, change.task.points], [20, 16]);
  const same = await setPoints(tasks, task.id, 16, 'wavecenter');
  assert.deepEqual([same.task.ownerPoints, same.task.points], [16, 14], 'owner 16 and AI 12 make 14');
  const cleared = await setPoints(tasks, task.id, 0, 'wavecenter');
  assert.deepEqual([cleared.task.ownerPoints, cleared.task.points], [null, 12], 'an owner’s 0 is "not set": the AI score stands alone');
});

test('all three parts average once other members vote', async () => {
  const { tasks, votes, task, rate } = await setup(20);
  await rate({ scope: 4, difficulty: 3, relevance: 4, demand: 3 }); // 17
  for (const [member, points] of [['a', 15], ['b', 20], ['c', 25]] as const) await castVote(votes.as(member), task.id, { points }, 'wavecenter');
  assert.equal((await tasks.get(task.id))?.points, 19, 'AI 17, owner 20, others 20 make 19');
});

test('a done task’s points do not move when the AI rates it, a member votes, or anything else changes', async () => {
  const { tasks, votes, task, rate } = await setup(10);
  await updateTask(tasks, task.id, { status: 'done' }, 'wavecenter');
  await rate(TWELVE);
  await castVote(votes.as('a'), task.id, { points: 40 }, 'wavecenter');
  await updateTask(tasks, task.id, { title: 'Plan the launch, again' }, 'wavecenter');
  await assert.rejects(setPoints(tasks, task.id, 30, 'wavecenter'), /points are locked/);
  let stored = await tasks.get(task.id);
  assert.deepEqual([stored?.points, stored?.ownerPoints], [10, 10]);
  await updateTask(tasks, task.id, { status: 'todo' }, 'wavecenter');
  stored = await tasks.get(task.id);
  assert.equal(stored?.points, 21, 'reopened, it takes its final score: AI 12, owner 10, others 40 make 20.67, so 21');
});
