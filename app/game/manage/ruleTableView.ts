/**
 * The Game Manager table's plain rules, kept apart from React so they can be
 * tested: which cells may be edited, what a one-cell save sends, and whether
 * a cell's typed value differs from what is stored.
 */
import { FACTOR_KEYS, FACTOR_TESTS, granularPoints, type FactorKey, type ScoringRule } from '../../../core/game.ts';

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

/** The four factor dropdowns as chosen: a level's number, or '' for not chosen. */
export type FactorForm = Record<FactorKey, string>;

export const BLANK_FACTORS: FactorForm = { effort: '', value: '', rarity: '', farmRisk: '' };

export function factorFormOf(rule: Pick<ScoringRule, 'factors'>): FactorForm {
  const f = rule.factors;
  return f ? { effort: String(f.effort), value: String(f.value), rarity: String(f.rarity), farmRisk: String(f.farmRisk) } : { ...BLANK_FACTORS };
}

/** Each dropdown's options: "0 – One click or one tick.", word for word from the document. */
export function factorOptions(key: FactorKey): { value: string; label: string }[] {
  return FACTOR_TESTS[key].levels.map((test, level) => ({ value: String(level), label: `${level} – ${test}` }));
}

/** How far the dropdowns are filled: a save sends all four or none, never some. */
export function factorFormState(form: FactorForm): 'all' | 'none' | 'some' {
  const chosen = FACTOR_KEYS.filter((k) => form[k] !== '').length;
  return chosen === FACTOR_KEYS.length ? 'all' : chosen === 0 ? 'none' : 'some';
}

/** What the formula gives for the chosen factors, or null until all four are chosen. */
export function formulaFor(form: FactorForm): number | null {
  if (factorFormState(form) !== 'all') return null;
  return granularPoints({ effort: Number(form.effort), value: Number(form.value), rarity: Number(form.rarity), farmRisk: Number(form.farmRisk) });
}

/** The chosen factors as core takes them: null for none. */
export function factorsFromForm(form: FactorForm): FactorForm | null {
  return factorFormState(form) === 'none' ? null : form;
}
