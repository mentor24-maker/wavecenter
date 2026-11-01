import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowStep, cardNote, prUrl, step, tasksByTicket, ticketId, viewFrom } from './evolutionView.ts';

test('only ?view=evolution opens the Evolution view; anything else is the list', () => {
  assert.equal(viewFrom('evolution'), 'evolution');
  assert.equal(viewFrom(['evolution', 'list']), 'evolution');
  assert.equal(viewFrom(undefined), 'list');
  assert.equal(viewFrom('board'), 'list');
  assert.equal(viewFrom(''), 'list');
});

test('a PR number links to GitHub; none (the first commit) links nowhere', () => {
  assert.equal(prUrl(56), 'https://github.com/mentor24-maker/wavecenter/pull/56');
  assert.equal(prUrl(null), null);
});

test('a change finds the task whose agent ticket is its ticket', () => {
  assert.equal(ticketId('https://app.clickup.com/t/86bcvtyhn'), '86bcvtyhn');
  assert.equal(ticketId(null), null);
  assert.equal(ticketId('https://example.com/t/x'), null);
  const map = tasksByTicket([
    { id: 'a', agentTicketUrl: null },
    { id: 'b', agentTicketUrl: 'https://app.clickup.com/t/86abc' },
    { id: 'c', agentTicketUrl: 'https://app.clickup.com/t/86abc' },
  ]);
  assert.equal(map.get('86abc'), 'b');
  assert.equal(map.size, 1);
});

test('the full-size view steps in merge order and stops at both ends', () => {
  assert.equal(step(0, -1, 3), null);
  assert.equal(step(0, 1, 3), 1);
  assert.equal(step(2, -1, 3), 1);
  assert.equal(step(2, 1, 3), null);
});

test('a card without a picture says why in plain words', () => {
  assert.equal(cardNote({ state: 'no screen', imageUrl: null, failureReason: null, page: null }), 'This change did not alter any screen.');
  assert.equal(
    cardNote({ state: 'failed', imageUrl: null, failureReason: 'the build failed.', page: '/tasks' }),
    'The screen could not be rebuilt for this change: the build failed.',
  );
  assert.match(cardNote({ state: 'captured', imageUrl: null, failureReason: null, page: '/game' }) ?? '', /screenshot of \/game could not be loaded/);
  assert.equal(cardNote({ state: 'captured', imageUrl: 'https://x/signed', failureReason: null, page: '/game' }), null);
});

test('the arrow keys still step back after Next is clicked to the last change', () => {
  // Click Next from the first of three until it stops at the last...
  let at = 0;
  for (let i = 0; i < 5; i++) at = step(at, 1, 3) ?? at;
  assert.equal(at, 2);
  // ...then ArrowLeft steps back, and ArrowRight from the first steps on.
  at = step(at, arrowStep('ArrowLeft')!, 3) ?? at;
  assert.equal(at, 1);
  assert.equal(step(0, arrowStep('ArrowRight')!, 3), 1);
  assert.equal(arrowStep('Escape'), null);
  assert.equal(arrowStep('a'), null);
});
