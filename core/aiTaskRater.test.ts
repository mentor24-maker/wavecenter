import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_RATING_TOOL,
  RATING_DETAILS_MAX,
  RATING_INSTRUCTION_VERSION,
  RATING_MODELS,
  RATING_RUN_MAX_TASKS,
  ratingFingerprint,
  ratingInstructions,
  ratingNeed,
  ratingRequest,
  ratingSubject,
  rateTasks,
  readModelAnswer,
  type LatestRating,
  type TaskRater,
} from './aiTaskRater.ts';
import { MemoryAiTaskRatingStore } from './memoryAiTaskRatingStore.ts';
import { INSTRUCTION_VERSION_MAX, TASK_FACTOR_KEYS, TASK_FACTOR_TESTS, aiScore, type TaskFactors } from './taskFactors.ts';
import type { Task } from './tasks.ts';

const admin = { role: 'admin' as const };
const member = { role: 'contributor' as const };

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    notes: null,
    ownerId: 'owner-1',
    status: 'todo',
    parentTaskId: null,
    points: 50,
    position: 0,
    priority: 'normal',
    agentSelected: false,
    agentTicketUrl: null,
    tool: 'wavecenter',
    createdAt: `2026-11-0${id.length}T00:00:00.000Z`,
    updatedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    ...over,
  };
}

function answer(f: TaskFactors, reason = 'Meets the test.'): string {
  return JSON.stringify(Object.fromEntries(TASK_FACTOR_KEYS.map((k) => [k, { rating: f[k], reason }])));
}

const typical: TaskFactors = { scope: 3, difficulty: 3, relevance: 3, demand: 3 };

/** A rater that answers per model, recording every call. */
function rater(byModel: Record<string, string | Error> = {}): TaskRater & { calls: { model: string; request: string }[] } {
  const calls: { model: string; request: string }[] = [];
  return {
    calls,
    async rate(model, _instructions, request) {
      calls.push({ model, request });
      const a = byModel[model] ?? answer(typical);
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

function run(over: Partial<Parameters<typeof rateTasks>[0]> = {}) {
  return rateTasks({
    actor: admin,
    tasks: [task('a')],
    fileNames: new Map(),
    latest: new Map(),
    store: new MemoryAiTaskRatingStore(),
    rater: rater(),
    tool: AI_RATING_TOOL,
    ...over,
  });
}

test('the instructions carry every factor test word for word, and say the server does the arithmetic', () => {
  const text = ratingInstructions();
  for (const k of TASK_FACTOR_KEYS) for (const level of TASK_FACTOR_TESTS[k].levels) assert.ok(text.includes(level), level);
  assert.match(text, /server does that/);
  assert.ok(RATING_INSTRUCTION_VERSION.length <= INSTRUCTION_VERSION_MAX);
});

test('the AI reads title, details, priority, parent, sub-tasks and file names, and never the points', () => {
  const parent = task('p', { title: 'The parent' });
  const t = task('t', { title: 'Rate me', notes: 'Some details', parentTaskId: 'p', priority: 'high', points: 37 });
  const kids = [task('k2', { title: 'Second kid', parentTaskId: 't' }), task('k1', { title: 'First kid', parentTaskId: 't' })];
  const text = ratingRequest(ratingSubject(t, [parent, t, ...kids], ['spec.pdf']));
  for (const part of ['Rate me', 'Some details', 'Priority: high', 'Parent task: The parent', 'First kid', 'Second kid', 'spec.pdf']) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(!text.includes('37'), 'the owner’s points are not shown to the AI');
  assert.ok(!text.includes('owner-1'), 'nor who owns it');
});

test('long details are cut at the cap and say so', () => {
  const text = ratingRequest(ratingSubject(task('t', { notes: 'x'.repeat(RATING_DETAILS_MAX + 50) }), [], []));
  assert.match(text, /cut here at 4000 characters/);
  assert.ok(!text.includes('x'.repeat(RATING_DETAILS_MAX + 1)));
});

test('the fingerprint changes with what the AI reads, not with read order or points', async () => {
  const base = task('t', { notes: 'Details' });
  const fp = await ratingFingerprint(ratingSubject(base, [], ['b', 'a']));
  assert.match(fp, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await ratingFingerprint(ratingSubject({ ...base, points: 1 }, [], ['a', 'b'])), fp);
  assert.notEqual(await ratingFingerprint(ratingSubject({ ...base, notes: 'New details' }, [], ['a', 'b'])), fp);
  assert.notEqual(await ratingFingerprint(ratingSubject(base, [], ['a'])), fp);
});

test('a well-formed answer becomes one model’s rating', () => {
  const r = readModelAnswer('claude-opus-5-5', answer({ scope: 5, difficulty: 4, relevance: 5, demand: 4 }, '  Reason.  '));
  assert.deepEqual(r.factors, { scope: 5, difficulty: 4, relevance: 5, demand: 4 });
  assert.equal(r.reasons.scope, 'Reason.');
  assert.equal(r.model, 'claude-opus-5-5');
});

test('a malformed answer is refused, naming the model', () => {
  assert.throws(() => readModelAnswer('m', 'not json'), /m did not answer in the fixed format/);
  assert.throws(() => readModelAnswer('m', 'null'), /fixed format/);
  assert.throws(() => readModelAnswer('m', answer({ ...typical, scope: 6 })), /m's answer was refused: Scope must be a whole number/);
  assert.throws(() => readModelAnswer('m', answer(typical, '   ')), /needs a reason/);
  const missing = JSON.parse(answer(typical));
  delete missing.demand;
  assert.throws(() => readModelAnswer('m', JSON.stringify(missing)), /demand is missing/);
});

test('which tasks need rating: open and unrated, changed, or under older instructions; never done', () => {
  const latest = (fingerprint: string, instructionVersion = RATING_INSTRUCTION_VERSION): LatestRating => ({ fingerprint, instructionVersion });
  assert.equal(ratingNeed(task('a'), 'fp', undefined), 'unrated');
  assert.equal(ratingNeed(task('a'), 'fp', latest('old')), 'changed');
  assert.equal(ratingNeed(task('a'), 'fp', latest('fp', 'task-factors-v0')), 'new-instructions');
  assert.equal(ratingNeed(task('a'), 'fp', latest('fp')), null);
  assert.equal(ratingNeed(task('a', { status: 'done' }), 'fp', undefined), null);
});

test('a run asks every model, saves the pass whole with its version, fingerprint and tool, and works out the AI score itself', async () => {
  const store = new MemoryAiTaskRatingStore();
  const r = rater({
    'claude-opus-5-5': answer({ scope: 5, difficulty: 4, relevance: 5, demand: 4 }),
    'claude-sonnet-5-5': answer({ scope: 5, difficulty: 4, relevance: 5, demand: 4 }),
  });
  const result = await run({ store, rater: r });
  assert.deepEqual(r.calls.map((c) => c.model).sort(), [...RATING_MODELS].sort());
  assert.equal(result.rated.length, 1);
  assert.equal(result.rated[0].aiScore, 36);
  assert.equal(result.rated[0].need, 'unrated');
  const [saved] = store.rows;
  assert.equal(saved.models.length, 2);
  assert.equal(saved.instructionVersion, RATING_INSTRUCTION_VERSION);
  assert.equal(saved.tool, AI_RATING_TOOL);
  assert.equal(saved.fingerprint, await ratingFingerprint(ratingSubject(task('a'), [task('a')], [])));
});

test('the models disagreeing by 2 or more levels is reported', async () => {
  const result = await run({
    rater: rater({ 'claude-opus-5-5': answer({ ...typical, difficulty: 1 }), 'claude-sonnet-5-5': answer({ ...typical, difficulty: 4 }) }),
  });
  assert.deepEqual(result.rated[0].disagreeOn, ['difficulty']);
  assert.equal(result.rated[0].aiScore, aiScore([{ ...typical, difficulty: 1 }, { ...typical, difficulty: 4 }]));
});

test('one model failing or answering badly saves nothing for that task, says why, and the run goes on', async () => {
  const store = new MemoryAiTaskRatingStore();
  const tasks = [task('a'), task('bb')];
  const flaky: TaskRater = {
    async rate(model, _instructions, request) {
      if (model === 'claude-sonnet-5-5' && request.includes('Title: Task a\n')) throw new Error('The AI service could not be reached.');
      return answer(typical);
    },
  };
  const result = await run({ store, tasks, rater: flaky });
  assert.deepEqual(result.failed, [{ taskId: 'a', title: 'Task a', reason: 'The AI service could not be reached.' }]);
  assert.deepEqual(result.rated.map((t) => t.taskId), ['bb']);
  assert.deepEqual(store.rows.map((r) => r.taskId), ['bb']);

  const bad = await run({ store: new MemoryAiTaskRatingStore(), rater: rater({ 'claude-opus-5-5': '{"scope":1}' }) });
  assert.equal(bad.rated.length, 0);
  assert.match(bad.failed[0].reason, /claude-opus-5-5's answer was refused/);
});

test('a run skips done and up-to-date tasks, takes unrated first, and stops at the cap', async () => {
  const tasks = [
    task('done', { status: 'done' }),
    task('fresh'),
    task('stale'),
    ...Array.from({ length: RATING_RUN_MAX_TASKS + 2 }, (_, i) => task(`new-${String(i).padStart(2, '0')}`)),
  ];
  const fp = async (t: Task) => ratingFingerprint(ratingSubject(t, tasks, []));
  const latest = new Map<string, LatestRating>([
    ['fresh', { fingerprint: await fp(tasks[1]), instructionVersion: RATING_INSTRUCTION_VERSION }],
    ['stale', { fingerprint: 'sha256:old', instructionVersion: RATING_INSTRUCTION_VERSION }],
  ]);
  const r = rater();
  const result = await run({ tasks, latest, rater: r });
  assert.equal(result.done, 1);
  assert.equal(result.upToDate, 1);
  assert.equal(result.rated.length, RATING_RUN_MAX_TASKS);
  assert.ok(result.rated.every((t) => t.need === 'unrated'));
  assert.equal(result.remaining, 3, 'two unrated and the changed one are left for the next run');
  assert.ok(!r.calls.some((c) => c.request.includes('Task done')));
});

test('only a role that may manage the game scoring may run it, and nothing is asked of the AI otherwise', async () => {
  const r = rater();
  await assert.rejects(run({ actor: member, rater: r }), /Only a role that may manage the game scoring/);
  assert.equal(r.calls.length, 0);
  await assert.rejects(run({ tool: '' }), /must name the tool/);
});
