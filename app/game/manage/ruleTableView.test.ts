import test from 'node:test';
import assert from 'node:assert/strict';
import { RULE_NAME_MAX, RULE_TEXT_MAX, type ScoringRule } from '../../../core/game.ts';
import { FIELD_MAX, formOf, formWith, isChanged } from './ruleTableView.ts';

const rule: ScoringRule = { kind: 'task_created', name: 'Made a task', description: 'Any new task.', criteria: 'One per task.', points: 3, position: 1 };

test('saving one cell sends the stored rule with only that cell changed', () => {
  assert.deepEqual(formWith(rule, 'points', '5'), { name: 'Made a task', description: 'Any new task.', criteria: 'One per task.', points: '5' });
  assert.deepEqual(formWith(rule, 'description', 'New words'), { ...formOf(rule), description: 'New words' });
});

test('a cell typed back to what is stored, or only padded with spaces, is not a change', () => {
  assert.equal(isChanged(rule, 'name', 'Made a task'), false);
  assert.equal(isChanged(rule, 'name', '  Made a task '), false);
  assert.equal(isChanged(rule, 'points', '3'), false);
  assert.equal(isChanged(rule, 'points', '4'), true);
  assert.equal(isChanged(rule, 'points', 'lots'), true);
});

test('the table holds the same length limits as core', () => {
  assert.equal(FIELD_MAX.name, RULE_NAME_MAX);
  assert.equal(FIELD_MAX.description, RULE_TEXT_MAX);
  assert.equal(FIELD_MAX.criteria, RULE_TEXT_MAX);
});
