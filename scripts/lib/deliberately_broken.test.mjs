import test from 'node:test';
import assert from 'node:assert/strict';
// Deliberately failing. Exists only to prove that main refuses a merge while
// the verify check is red (ticket 86bcgh5n5, acceptance criterion 3).
// This PR is closed, never merged.
test('this test fails on purpose', () => { assert.equal(1, 2); });
