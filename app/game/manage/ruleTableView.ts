/**
 * The Game Manager table's plain rules, kept apart from React so they can be
 * tested: which cells may be edited, what a one-cell save sends, and whether
 * a cell's typed value differs from what is stored.
 */
import type { ScoringRule } from '../../../core/game.ts';

/** The form one save sends: every editable part, as text. */
export interface RuleFormValues {
  name: string;
  description: string;
  criteria: string;
  points: string;
}

/** The cells an admin may change. Kind is the action's key and is never edited. */
export type RuleField = keyof RuleFormValues;

export const FIELD_LABELS: Record<RuleField, string> = {
  name: 'Name',
  points: 'Points',
  description: 'Description',
  criteria: 'What counts',
};

/** The text cells: these get the pop-up with the large text box. */
export const TEXT_FIELDS: readonly RuleField[] = ['name', 'description', 'criteria'];

/** The longest each part may be, the same limits core and the database hold (RULE_NAME_MAX, RULE_TEXT_MAX). */
export const FIELD_MAX: Record<RuleField, number | undefined> = { name: 80, description: 500, criteria: 500, points: undefined };

export const BLANK_FORM: RuleFormValues = { name: '', description: '', criteria: '', points: '1' };

export function formOf(rule: ScoringRule): RuleFormValues {
  return { name: rule.name, description: rule.description, criteria: rule.criteria, points: String(rule.points) };
}

/** What saving one cell sends: the stored rule, with only that cell replaced by what was typed. */
export function formWith(rule: ScoringRule, field: RuleField, typed: string): RuleFormValues {
  return { ...formOf(rule), [field]: typed };
}

/** Did the admin change this cell? Spaces at the ends do not count, as core trims them. */
export function isChanged(rule: ScoringRule, field: RuleField, typed: string): boolean {
  return formOf(rule)[field].trim() !== typed.trim();
}
