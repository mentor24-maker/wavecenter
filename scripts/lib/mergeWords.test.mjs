import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMergePhrase, findAuthorization, danesAnswer, refusalNotice, alreadyNoticed, verifyState, prDecision,
  mergedComment, mergeRecorded, conflictToSettle, settledLine, notSettledLine, settleCardProblem, SETTLE_REPLY_LINE, SETTLE_TODO,
} from './mergeWords.mjs';
import { stampMachineComment } from './machineComment.mjs';
import { verdictComment } from './loopTrail.mjs';

const DANE = 48012725;
const OTHER = 54254347;

let clock = 1000;
const say = (text, { user = DANE, machine = false } = {}) => ({
  id: `c${clock}`,
  date: String((clock += 1000)),
  user: { id: user },
  comment_text: machine ? stampMachineComment(text) : text,
});
const passed = () => say(verdictComment(true, 'all green'), { machine: true });

function authorized(text, { status = 'ready to launch', user = DANE, machine = false } = {}) {
  const comments = [passed(), say(text, { user, machine })];
  return findAuthorization({ status, comments, operatorId: DANE }).ok;
}

test('the merge phrases authorize, whole and loosely punctuated', () => {
  for (const w of ['merge', 'Merge!', 'merge it', 'ship it', 'approve', '  MERGE.  ', 'merge\n']) {
    assert.equal(authorized(w), true, `"${w}" should authorize`);
  }
});

test('a fenced or formatted "merge" still authorizes: the wrapper is the editor, not him', () => {
  assert.equal(authorized('```\nmerge\n```'), true);
  assert.equal(authorized('```cpp\nmerge\n```'), true);
  assert.equal(authorized('**merge**'), true);
  assert.equal(authorized('`merge`'), true);
  assert.equal(authorized('merge​'), true);
});

test('a sentence that merely contains a keyword does not authorize', () => {
  for (const w of ['do not merge this yet', "I'll approve the design later", 'merge after lunch', 'merged?']) {
    assert.equal(authorized(w), false, `"${w}" must not authorize`);
  }
});

test('a [machine]-stamped "merge" does not authorize, though it was posted under his seat', () => {
  assert.equal(authorized('merge', { machine: true }), false);
});

test('a "merge" from any other user id does not authorize', () => {
  assert.equal(authorized('merge', { user: OTHER }), false);
});

test('a "merge" on a ticket not in Ready to launch does not authorize', () => {
  for (const status of ['in review', 'needs your input', 'building', 'queued', 'live']) {
    assert.equal(authorized('merge', { status }), false, status);
  }
});

test("a later plain comment from Dane cancels his merge; the lane's own notices do not", () => {
  const cancelled = [passed(), say('merge'), say('wait, not yet')];
  assert.equal(findAuthorization({ status: 'Ready to launch', comments: cancelled, operatorId: DANE }).ok, false);
  const noticed = [passed(), say('merge'), say(refusalNotice({ authorizationId: 'x', code: 'verify-red', why: 'w', todo: 't' }), { machine: true })];
  assert.equal(findAuthorization({ status: 'Ready to launch', comments: noticed, operatorId: DANE }).ok, true);
});

test('a "merge" older than the newest review verdict authorized an earlier round, and says so', () => {
  const comments = [passed(), say('merge'), say(verdictComment(false, 'broke'), { machine: true }), passed()];
  const got = findAuthorization({ status: 'Ready to launch', comments, operatorId: DANE });
  assert.equal(got.ok, false);
  assert.equal(got.code, 'stale-merge');
});

test('no PASS verdict means no merge, even with his word', () => {
  const got = findAuthorization({ status: 'Ready to launch', comments: [say('merge')], operatorId: DANE });
  assert.equal(got.ok, false);
  assert.equal(got.code, 'no-pass');
});

test('a merge phrase that names the ticket\'s own PR authorizes; any other PR number does not', () => {
  const prLine = () => say('PR opened: https://github.com/o/r/pull/17', { machine: true });
  for (const w of ['merge PR #17', 'merge pr 17', 'Merge #17', 'merge pull request #17', 'ship it PR #17.', '**merge PR #17**']) {
    const got = findAuthorization({ status: 'Ready to launch', comments: [prLine(), passed(), say(w)], operatorId: DANE });
    assert.equal(got.ok, true, `"${w}" should authorize`);
  }
  const wrong = findAuthorization({ status: 'Ready to launch', comments: [prLine(), passed(), say('merge PR #18')], operatorId: DANE });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'wrong-pr');
  const none = findAuthorization({ status: 'Ready to launch', comments: [passed(), say('merge #17')], operatorId: DANE });
  assert.equal(none.code, 'wrong-pr');
  for (const w of ['merge PR #17 after lunch', 'do not merge PR #17', 'merge PR', 'merge #', 'merge pr #17 #18']) {
    assert.equal(isMergePhrase(w), false, `"${w}" must not be a merge phrase`);
  }
});

test('isMergePhrase alone knows nothing of authors', () => {
  assert.equal(isMergePhrase('Ship it!'), true);
  assert.equal(isMergePhrase('ship it now'), false);
});

test("Dane's plain answer on Needs your input is found; a loop's comment or a merge word is not", () => {
  const card = say('NEEDED FROM DANE: a or b?', { machine: true });
  const answer = say('a');
  assert.equal(danesAnswer({ status: 'Needs your input', comments: [card, answer], operatorId: DANE })?.id, answer.id);
  assert.equal(danesAnswer({ status: 'Needs your input', comments: [answer, say('noted', { machine: true })], operatorId: DANE }), null);
  assert.equal(danesAnswer({ status: 'Needs your input', comments: [card, say('merge')], operatorId: DANE }), null);
  assert.equal(danesAnswer({ status: 'Ready to launch', comments: [card, answer], operatorId: DANE }), null);
});

test('a refusal is noticed once per authorization and reason', () => {
  const notice = say(refusalNotice({ authorizationId: 'c9', code: 'verify-red', why: 'red', todo: 'fix' }), { machine: true });
  assert.equal(alreadyNoticed([notice], 'c9', 'verify-red'), true);
  assert.equal(alreadyNoticed([notice], 'c9', 'conflict'), false);
  assert.equal(alreadyNoticed([notice], 'c10', 'verify-red'), false);
  const unstamped = say(refusalNotice({ authorizationId: 'c9', code: 'verify-red', why: 'red', todo: 'fix' }));
  assert.equal(alreadyNoticed([unstamped], 'c9', 'verify-red'), false);
});

const run = (conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name: 'verify', status, conclusion });

test('the verify check is read from both shapes GitHub reports', () => {
  assert.equal(verifyState([run('SUCCESS')]), 'green');
  assert.equal(verifyState([run('FAILURE')]), 'red');
  assert.equal(verifyState([run('', 'IN_PROGRESS')]), 'pending');
  assert.equal(verifyState([{ __typename: 'StatusContext', context: 'Vercel', state: 'SUCCESS' }]), 'missing');
  assert.equal(verifyState([run('SUCCESS'), run('FAILURE')]), 'red');
});

const pr = (over = {}) => ({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [run('SUCCESS')], ...over });

test('a red or conflicting PR is never merged', () => {
  assert.deepEqual(prDecision(pr({ statusCheckRollup: [run('FAILURE')] })).code, 'verify-red');
  assert.deepEqual(prDecision(pr({ mergeable: 'CONFLICTING' })).code, 'conflict');
  assert.equal(prDecision(pr({ statusCheckRollup: [] })).code, 'verify-missing');
  assert.equal(prDecision(pr({ state: 'CLOSED' })).code, 'pr-closed');
});

test('a green PR merges; behind main it is caught up first; GitHub still working means wait', () => {
  assert.equal(prDecision(pr()).act, 'merge');
  assert.equal(prDecision(pr(), { behindBy: 2 }).act, 'update-branch');
  assert.equal(prDecision(pr({ mergeable: 'UNKNOWN' })).act, 'wait');
  assert.equal(prDecision(pr({ statusCheckRollup: [run('', 'QUEUED')] })).act, 'wait');
  assert.equal(prDecision(pr({ state: 'MERGED' })).act, 'already-merged');
});

test('a merge is recorded once per PR', () => {
  const url = 'https://github.com/o/r/pull/7';
  const done = say(mergedComment({ prUrl: url, commit: 'abc1234', body: 'Merged on your word.' }), { machine: true });
  assert.equal(mergeRecorded([done], url), true);
  assert.equal(mergeRecorded([done], 'https://github.com/o/r/pull/70'), false);
  assert.equal(mergeRecorded([], url), false);
});

// ── The build loop settles a conflict on an approved PR ─────────────────────

function conflicted(code = 'conflict') {
  const pass = passed();
  const merge = say('merge');
  const notice = say(refusalNotice({ authorizationId: merge.id, code, why: 'conflicts', todo: SETTLE_TODO }), { machine: true });
  return { merge, notice, comments: [pass, merge, notice] };
}
const owed = (comments, status = 'Ready to launch') => conflictToSettle({ status, comments, operatorId: DANE });

test('a standing "merge" refused for a conflict or a failed catch-up is owed a fix', () => {
  for (const code of ['conflict', 'catch-up-failed']) {
    const { merge, comments } = conflicted(code);
    assert.deepEqual(owed(comments), { ok: true, authorizationId: merge.id, code });
  }
});

test('other refusals, a missing refusal, a lapsed "merge" or another status are not owed a fix', () => {
  assert.equal(owed(conflicted('verify-red').comments).ok, false);
  assert.equal(owed([passed(), say('merge')]).ok, false);
  assert.equal(owed([...conflicted().comments, say('wait, not yet')]).ok, false);
  assert.equal(owed(conflicted().comments, 'In review').ok, false);
});

test('once settled or asked about, the build loop does not take it again', () => {
  const { merge, comments } = conflicted();
  const head = { authorizationId: merge.id, code: 'conflict' };
  assert.equal(owed([...comments, say(`${settledLine(head)}\n\nkept both`, { machine: true })]).ok, false);
  assert.equal(owed([...comments, say(`${notSettledLine(head)}\n\nNEEDED FROM DANE`, { machine: true })]).ok, false);
});

test('a conflict that comes back after a fix is noticed afresh, and owed a fix again', () => {
  const { merge, notice, comments } = conflicted();
  const settled = say(`${settledLine({ authorizationId: merge.id, code: 'conflict' })}\n\nkept both`, { machine: true });
  assert.equal(alreadyNoticed([...comments], merge.id, 'conflict'), true);
  assert.equal(alreadyNoticed([...comments, settled], merge.id, 'conflict'), false);
  const again = say(notice.comment_text, { machine: true });
  assert.equal(alreadyNoticed([...comments, settled, again], merge.id, 'conflict'), true);
  assert.equal(owed([...comments, settled, again]).ok, true);
});

test('after the build loop asks Dane, neither loop posts again until he answers', () => {
  const { merge, comments } = conflicted();
  const card = say(`${notSettledLine({ authorizationId: merge.id, code: 'conflict' })}\n\nboth sides changed the same thing`, { machine: true });
  assert.equal(alreadyNoticed([...comments, card], merge.id, 'conflict'), true);
  assert.equal(owed([...comments, card]).ok, false);
});

test('the conflict refusal no longer asks Dane to move the ticket', () => {
  const d = prDecision(pr({ mergeable: 'CONFLICTING' }));
  assert.equal(d.todo, SETTLE_TODO);
  assert.doesNotMatch(SETTLE_TODO, /move the ticket|Rework/i);
  assert.match(SETTLE_TODO, /build loop/);
});

test('a settle-blocked card must tell Dane to write merge after his answer', () => {
  assert.equal(settleCardProblem(`Keep option A (the old sort) or option B (the new sort)?\n\n${SETTLE_REPLY_LINE}`), null);
  assert.equal(settleCardProblem(`Option A or B?   reply with your choice, then\nwrite merge as its own comment.`), null);
  assert.match(settleCardProblem('Keep option A or option B?'), /write merge as its own comment/);
  assert.match(settleCardProblem('Should I merge option A or option B?'), /write merge as its own comment/);
  assert.notEqual(settleCardProblem(''), null);
});

test('his plain answer to the card lapses the "merge", which is why the card asks for a fresh one', () => {
  const { merge, comments } = conflicted();
  const card = say(`${notSettledLine({ authorizationId: merge.id, code: 'conflict' })}\n\n${SETTLE_REPLY_LINE}`, { machine: true });
  const answer = say('keep option A');
  assert.equal(owed([...comments, card, answer]).ok, false);
  const again = say('merge');
  const notice = say(refusalNotice({ authorizationId: again.id, code: 'conflict', why: 'conflicts', todo: SETTLE_TODO }), { machine: true });
  assert.deepEqual(owed([...comments, card, answer, again, notice]), { ok: true, authorizationId: again.id, code: 'conflict' });
});
