import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowStep, cardNote, cardWords, changeStatement, emptyScrollerNote, prUrl, showsOnScroller, step, viewFrom } from './evolutionView.ts';

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

test('only changes that altered a screen are cards', () => {
  assert.equal(showsOnScroller('captured'), true);
  assert.equal(showsOnScroller('no screen'), false);
  assert.equal(showsOnScroller('failed'), false);
});

const ROW = {
  title: 'The header picture looks muddy to every member: lighten the dark overlay so its colors show',
  prompt: null as string | null,
  thread_url: null as string | null,
  ticket_url: 'https://app.clickup.com/t/86bcw3my3' as string | null,
  pr_number: 82 as number | null,
};

test('a card shows Dane\'s own words, verbatim, and links to where he said them', () => {
  const card = cardWords({ ...ROW, prompt: '  The header background overlay is too dark\n', thread_url: '/tasks/a1611610-e4d7-4b13-ac2f-bf909f57db1d' });
  assert.deepEqual(card, { words: 'The header background overlay is too dark', fromDane: true, threadUrl: '/tasks/a1611610-e4d7-4b13-ac2f-bf909f57db1d' });
});

test('with none of his words on record, a card says briefly what changed and links to its ticket or PR', () => {
  assert.deepEqual(cardWords(ROW), { words: 'Lighten the dark overlay so its colors show', fromDane: false, threadUrl: 'https://app.clickup.com/t/86bcw3my3' });
  assert.equal(cardWords({ ...ROW, ticket_url: null }).threadUrl, 'https://github.com/mentor24-maker/wavecenter/pull/82');
  assert.equal(cardWords({ ...ROW, prompt: '   ' }).fromDane, false);
  assert.equal(cardWords({ ...ROW, ticket_url: null, pr_number: null }).threadUrl, null);
});

test('the short statement is the fix half of a ticket name, or the whole name', () => {
  assert.equal(changeStatement('Dane cannot reach the task list from the menu: add Tasks as the first menu item'), 'Add Tasks as the first menu item');
  assert.equal(changeStatement('Make the site presentable and give it a domain'), 'Make the site presentable and give it a domain');
  assert.equal(changeStatement('WaveCenter: first commit — README and .gitignore'), 'First commit — README and .gitignore');
});

test('an empty scroller says why', () => {
  assert.match(emptyScrollerNote(3), /None of the 3 recorded changes altered a screen/);
  assert.match(emptyScrollerNote(1), /None of the 1 recorded change altered/);
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
