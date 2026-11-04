import test from 'node:test';
import assert from 'node:assert/strict';
import { taskScore } from '../../core/taskScore.ts';
import { aiScoreSum, disagreement, finalScoreWorking, plainNumber, ratingFromRow, type AiRatingRow } from './scoreView.ts';

const row: AiRatingRow = {
  scope: '3', difficulty: '3.5', relevance: 3, demand: 4, ai_score: 15,
  instruction_version: 'v1', created_at: '2026-11-04T20:00:00Z',
  ai_task_model_ratings: [
    { model: 'claude-sonnet-5-5', scope: 3, difficulty: 4, relevance: 3, demand: 4, scope_reason: 's2', difficulty_reason: 'd2', relevance_reason: 'r2', demand_reason: 'm2' },
    { model: 'claude-opus-5-5', scope: 3, difficulty: 3, relevance: 3, demand: 4, scope_reason: 's1', difficulty_reason: 'd1', relevance_reason: 'r1', demand_reason: 'm1' },
  ],
};

test('a database row reads as numbers, each model with its own ratings and reasons', () => {
  const r = ratingFromRow(row);
  assert.deepEqual(r.factors, { scope: 3, difficulty: 3.5, relevance: 3, demand: 4 });
  assert.deepEqual(r.models.map((m) => m.model), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.equal(r.models[1].reasons.difficulty, 'd2');
  assert.equal(r.models[0].factors.difficulty, 3);
});

test('a rating with no model rows reads as an empty list, not a crash', () => {
  assert.deepEqual(ratingFromRow({ ...row, ai_task_model_ratings: null }).models, []);
});

test('the AI score sum is the formula with the averaged ratings, ending in the stored score', () => {
  assert.equal(aiScoreSum(ratingFromRow(row)), '3 × 3.5 × (3 + 4) ÷ 5 = 14.7, so 15');
  assert.equal(aiScoreSum(ratingFromRow({ ...row, scope: 5, difficulty: 4, relevance: 5, demand: 4, ai_score: 36 })), '5 × 4 × (5 + 4) ÷ 5 = 36');
});

test('models 2 or more levels apart on a factor are named; 1 apart is agreement', () => {
  assert.deepEqual(disagreement(ratingFromRow(row)), []);
  const split = { ...row, ai_task_model_ratings: [row.ai_task_model_ratings![0], { ...row.ai_task_model_ratings![1], demand: 2 }] };
  assert.deepEqual(disagreement(ratingFromRow(split)), ['demand']);
});

test('plain numbers drop float noise', () => {
  assert.equal(plainNumber(3.5000000001), '3.5');
  assert.equal(plainNumber(12), '12');
});

const task = (ownerPoints: number | null, status: 'todo' | 'done' = 'todo', points = 0) => ({ ownerId: 'owner', ownerPoints, status, points });

test("the final score's sum matches core: the ticket's own example", () => {
  const s = taskScore(task(10), 12, []);
  assert.equal(s.final, 11);
  assert.equal(finalScoreWorking(s), "(12 + 10) ÷ 2 = 11, the average of the AI score and the owner's score");
});

test('a half rounds up, and the sum says so', () => {
  const s = taskScore(task(30), 13, []);
  assert.equal(finalScoreWorking(s), "(13 + 30) ÷ 2 = 21.5, so 22, the average of the AI score and the owner's score");
});

test("other members' votes join the average when there are any", () => {
  const s = taskScore(task(20), 17, [{ memberId: 'a', points: 15 }, { memberId: 'b', points: 25 }, { memberId: 'owner', points: 50 }]);
  assert.equal(finalScoreWorking(s), "(17 + 20 + 20) ÷ 3 = 19, the average of the AI score, the owner's score and the other members' score");
});

test('before the AI rates it, the owner score stands alone; with nothing at all it is 0', () => {
  assert.equal(finalScoreWorking(taskScore(task(10), null, [])), "the owner's score on its own");
  assert.equal(finalScoreWorking(taskScore(task(null), null, [])), 'no score has been given yet, so 0');
});
