import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryAiTaskRatingStore } from './memoryAiTaskRatingStore.ts';
import {
  AI_SCORE_EXAMPLES,
  AI_SCORE_MAX,
  AI_SCORE_MIN,
  INSTRUCTION_VERSION_MAX,
  MODEL_MAX,
  TASK_FACTOR_KEYS,
  TASK_FACTOR_MAX,
  TASK_FACTOR_MIN,
  TASK_FACTOR_TESTS,
  TASK_REASON_MAX,
  aiScore,
  aiScoreWorking,
  checkAiTaskRating,
  checkTaskFactorReasons,
  checkTaskFactors,
  currentAiTaskRating,
  recordAiTaskRating,
  type AiTaskRatingInput,
  type TaskFactors,
} from './taskFactors.ts';

const TOOL = 'ai-rating';
const typical: TaskFactors = { scope: 3, difficulty: 3, relevance: 3, demand: 3 };
const reasons = {
  scope: 'A new feature on one screen.',
  difficulty: 'Needs real thought.',
  relevance: 'Adds something members use.',
  demand: 'Members would notice it soon.',
};
const input = (over: Partial<AiTaskRatingInput> = {}): AiTaskRatingInput => ({
  taskId: 'task-1', factors: typical, reasons, model: 'claude-opus-5-5', instructionVersion: 'v1', tool: TOOL, ...over,
});

test('the four factors are scope, difficulty, relevance and demand, each with a test for every level 1 to 5', () => {
  assert.deepEqual(TASK_FACTOR_KEYS, ['scope', 'difficulty', 'relevance', 'demand']);
  assert.equal(TASK_FACTOR_MIN, 1);
  assert.equal(TASK_FACTOR_MAX, 5);
  assert.deepEqual(TASK_FACTOR_KEYS.map((k) => TASK_FACTOR_TESTS[k].letter), ['S', 'D', 'R', 'M']);
  for (const k of TASK_FACTOR_KEYS) {
    const t = TASK_FACTOR_TESTS[k];
    assert.equal(t.levels.length, 5, `${k} has a test for each of the five levels`);
    for (const level of t.levels) assert.ok(level.trim().length > 0, `${k} has no blank level`);
    assert.ok(t.name && t.measures);
  }
});

test('the level tests are the design document’s, word for word', () => {
  const doc = readFileSync(new URL('../docs/GLOBULAR_SCORING_ALGORITHM.md', import.meta.url), 'utf8');
  for (const k of TASK_FACTOR_KEYS) {
    const t = TASK_FACTOR_TESTS[k];
    t.levels.forEach((level, i) => assert.ok(doc.includes(`| ${i + 1} | ${level} |`), `${t.name} ${i + 1}: "${level}" is in the design`));
  }
});

test('every whole number from 1 to 5 is accepted on every factor', () => {
  for (const k of TASK_FACTOR_KEYS) {
    for (let level = 1; level <= 5; level += 1) {
      assert.equal(checkTaskFactors({ ...typical, [k]: level })[k], level);
    }
  }
  assert.deepEqual(checkTaskFactors({ scope: '2', difficulty: ' 3 ', relevance: 4, demand: 5 }), { scope: 2, difficulty: 3, relevance: 4, demand: 5 });
});

test('a rating outside the scale, or not a whole number, is refused in plain words', () => {
  for (const bad of [0, 6, -1, 2.5, 'three', true]) {
    assert.throws(() => checkTaskFactors({ ...typical, difficulty: bad }), /Difficulty must be a whole number from 1 to 5\. Nothing was saved\./, String(bad));
  }
});

test('a missing factor is refused, naming it', () => {
  assert.throws(() => checkTaskFactors({ scope: 1, difficulty: 2, relevance: 3 }), /demand is missing/);
  assert.throws(() => checkTaskFactors({ scope: 1, difficulty: '', relevance: 3 }), /difficulty and demand are missing/);
  assert.throws(() => checkTaskFactors(null), /none was given/);
});

test('every rating needs its reason: blank, missing or too long is refused, and each is trimmed', () => {
  assert.deepEqual(checkTaskFactorReasons({ ...reasons, scope: '  A new feature on one screen.  ' }), reasons);
  assert.throws(() => checkTaskFactorReasons({ ...reasons, relevance: '   ' }), /Relevance needs a reason/);
  assert.throws(() => checkTaskFactorReasons({ scope: 'x', difficulty: 'x', relevance: 'x' }), /Demand needs a reason/);
  assert.throws(() => checkTaskFactorReasons({ ...reasons, demand: 'x'.repeat(TASK_REASON_MAX + 1) }), /the most is 300/);
  assert.equal(checkTaskFactorReasons({ ...reasons, demand: 'x'.repeat(TASK_REASON_MAX) }).demand.length, TASK_REASON_MAX);
  assert.throws(() => checkTaskFactorReasons(undefined), /none was given/);
});

test('the formula is S × D × (R + M) ÷ 5, a half rounding up, never less than 1', () => {
  assert.equal(aiScore({ scope: 1, difficulty: 1, relevance: 1, demand: 1 }), 1, '0.4 is floored to 1');
  assert.equal(aiScore(typical), 11, '10.8 rounds to 11');
  assert.equal(aiScore({ scope: 5, difficulty: 5, relevance: 5, demand: 5 }), 50);
  assert.equal(AI_SCORE_MIN, 1);
  assert.equal(AI_SCORE_MAX, 50);
});

test('the formula gives the design’s worked examples', () => {
  for (const ex of AI_SCORE_EXAMPLES) assert.equal(aiScore(ex.factors), ex.aiScore, ex.task);
  assert.deepEqual(AI_SCORE_EXAMPLES.map((ex) => ex.aiScore), [36, 13, 17, 1]);
  assert.equal(aiScoreWorking(AI_SCORE_EXAMPLES[1].factors), '3 × 3 × (3 + 4) ÷ 5 = 12.6, so 13');
  assert.equal(aiScoreWorking(AI_SCORE_EXAMPLES[0].factors), '5 × 4 × (5 + 4) ÷ 5 = 36');
});

test('every possible rating scores from 1 to 50', () => {
  const levels = [1, 2, 3, 4, 5];
  for (const scope of levels) for (const difficulty of levels) for (const relevance of levels) for (const demand of levels) {
    const s = aiScore({ scope, difficulty, relevance, demand });
    assert.ok(Number.isInteger(s) && s >= 1 && s <= 50);
  }
});

test('two models’ ratings are averaged unrounded, and only the AI score is rounded', () => {
  // Scope 2 and 3 average to 2.5: 2.5 × 2 × (2 + 2) ÷ 5 = 4 exactly. Rounding the factor first would give 3 × 2 × 4 ÷ 5 = 4.8, so 5.
  assert.equal(aiScore([{ scope: 2, difficulty: 2, relevance: 2, demand: 2 }, { scope: 3, difficulty: 2, relevance: 2, demand: 2 }]), 4);
  // A half rounds up: 2.5 × 1 × (2 + 3) ÷ 5 = 2.5, so 3.
  assert.equal(aiScore([{ scope: 2, difficulty: 1, relevance: 2, demand: 3 }, { scope: 3, difficulty: 1, relevance: 2, demand: 3 }]), 3);
  assert.equal(aiScore([typical]), aiScore(typical));
  assert.throws(() => aiScore([]), /no rating/);
  assert.throws(() => aiScore([typical, { ...typical, demand: 9 }]), /Demand must be/);
});

test('a whole rating is checked, and its AI score comes from the formula', () => {
  const row = checkAiTaskRating(input({ model: ' claude-opus-5-5 ', instructionVersion: ' v1 ' }));
  assert.deepEqual(row, { taskId: 'task-1', factors: typical, reasons, aiScore: 11, model: 'claude-opus-5-5', instructionVersion: 'v1', tool: TOOL });
});

test('a rating without its model, instruction version, reasons, task or tool is refused', () => {
  assert.throws(() => checkAiTaskRating(input({ model: '' })), /which model made it/);
  assert.throws(() => checkAiTaskRating(input({ model: undefined })), /which model made it/);
  assert.throws(() => checkAiTaskRating(input({ model: 'm'.repeat(MODEL_MAX + 1) })), /the most is 100/);
  assert.throws(() => checkAiTaskRating(input({ instructionVersion: '  ' })), /which version of the instructions/);
  assert.throws(() => checkAiTaskRating(input({ instructionVersion: 'v'.repeat(INSTRUCTION_VERSION_MAX + 1) })), /the most is 40/);
  assert.throws(() => checkAiTaskRating(input({ reasons: undefined })), /needs its reason/);
  assert.throws(() => checkAiTaskRating(input({ taskId: '' })), /name its task/);
  assert.throws(() => checkAiTaskRating(input({ tool: '' })), /must name the tool/);
  assert.throws(() => checkAiTaskRating(input({ factors: { ...typical, scope: 0 } })), /Scope must be/);
});

test('the AI cannot hand in its own AI score', () => {
  assert.throws(() => checkAiTaskRating({ ...input(), aiScore: 50 } as AiTaskRatingInput), /cannot be handed in/);
});

test('each rating adds a row, the newest is the current one, and a refused one saves nothing', async () => {
  const store = new MemoryAiTaskRatingStore();
  assert.equal(await currentAiTaskRating(store, 'task-1'), null);
  const first = await recordAiTaskRating(store, input());
  const second = await recordAiTaskRating(store, input({ factors: { scope: 5, difficulty: 4, relevance: 5, demand: 4 }, model: 'claude-sonnet-5-5' }));
  await assert.rejects(recordAiTaskRating(store, input({ factors: { ...typical, demand: 6 } })), /Demand must be/);
  assert.equal(store.rows.length, 2);
  const history = await store.forTask('task-1');
  assert.deepEqual(history.map((r) => r.id), [second.id, first.id]);
  const current = await currentAiTaskRating(store, 'task-1');
  assert.equal(current?.aiScore, 36);
  assert.equal(current?.model, 'claude-sonnet-5-5');
  assert.equal(first.aiScore, 11, 'the older row is kept as it was');
  assert.deepEqual(await store.forTask('task-2'), []);
});

test('the migration checks the same scale, limits and formula as core', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261104120000_ai_task_factor_ratings.sql', import.meta.url), 'utf8');
  for (const k of TASK_FACTOR_KEYS) {
    assert.match(sql, new RegExp(`${k}\\s+integer\\s+not null check \\(${k} between ${TASK_FACTOR_MIN} and ${TASK_FACTOR_MAX}\\)`));
    assert.match(sql, new RegExp(`${k}_reason\\s+text\\s+not null check \\(length\\(btrim\\(${k}_reason\\)\\) between 1 and ${TASK_REASON_MAX}\\)`));
  }
  assert.match(sql, new RegExp(`ai_score\\s+integer\\s+not null check \\(ai_score between ${AI_SCORE_MIN} and ${AI_SCORE_MAX}\\)`));
  assert.match(sql, new RegExp(`model\\s+text\\s+not null check \\(length\\(btrim\\(model\\)\\) between 1 and ${MODEL_MAX}\\)`));
  assert.match(sql, new RegExp(`instruction_version text\\s+not null check \\(length\\(btrim\\(instruction_version\\)\\) between 1 and ${INSTRUCTION_VERSION_MAX}\\)`));
  assert.match(sql, /ai_score = greatest\(1, round\(scope \* difficulty \* \(relevance \+ demand\) \/ 5\.0\)::integer\)/);
  assert.match(sql, /alter table public\.ai_task_ratings enable row level security;/);
  assert.match(sql, /revoke all on public\.ai_task_ratings from anon, authenticated;\ngrant select on public\.ai_task_ratings to authenticated;/);
});
