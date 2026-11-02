import test from 'node:test';
import assert from 'node:assert/strict';
import { wordCount, nameProblem } from './ticketName.mjs';

const words = (n) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');

test('counts plain words', () => {
  assert.equal(wordCount(words(6)), 6);
  assert.equal(wordCount(words(12)), 12);
  assert.equal(wordCount(words(13)), 13);
  assert.equal(wordCount(''), 0);
});

test('hyphenated and numbered words count as one; lone punctuation counts as none', () => {
  assert.equal(wordCount('Ticket titles get wordy: use Dane own title or 6-12 words'), 11);
  assert.equal(wordCount('sign-in — works  again'), 3);
});

test('6 and 12 words pass; 5 and 13 do not', () => {
  assert.equal(nameProblem(words(6)), null);
  assert.equal(nameProblem(words(12)), null);
  assert.match(nameProblem(words(5)), /5 word\(s\)/);
  assert.match(nameProblem(words(13)), /13 words/);
});

test("Dane's own words skip the minimum but never the 12-word limit", () => {
  assert.equal(nameProblem('Add the logo', { danes: true }), null);
  assert.match(nameProblem(words(13), { danes: true }), /condensed to 12 or fewer/);
});
