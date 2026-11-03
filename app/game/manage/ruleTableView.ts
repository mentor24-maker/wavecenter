/**
 * The Game Manager table's plain rules, kept apart from React so they can be
 * tested: which cells may be edited, what a one-cell save sends, and whether
 * a cell's typed value differs from what is stored.
 */
import { FACTOR_KEYS, FACTOR_TESTS, NO_REASONS, REASON_MAX, granularPoints, type FactorKey, type ScoringRule } from '../../../core/game.ts';

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

/** The four reasons as text, '' for one not written yet. */
export type ReasonForm = Record<FactorKey, string>;

/** The longest a reason's box takes: core's own limit. */
export const REASON_BOX_MAX = REASON_MAX;

export const BLANK_REASONS: ReasonForm = { effort: '', value: '', rarity: '', farmRisk: '' };

/** A rule's stored reasons as text, '' for one not written yet. */
export function reasonFormOf(rule: Pick<ScoringRule, 'reasons'>): ReasonForm {
  const stored = { ...NO_REASONS, ...rule.reasons };
  return { effort: stored.effort ?? '', value: stored.value ?? '', rarity: stored.rarity ?? '', farmRisk: stored.farmRisk ?? '' };
}

/** The new action's reasons as core takes them: null when none was written. */
export function reasonsFromForm(form: ReasonForm): ReasonForm | null {
  return FACTOR_KEYS.some((k) => form[k].trim()) ? form : null;
}

/** The button beside a factor's dropdown: what it reads to a screen reader, and its hover text. */
export function reasonButtonLabel(key: FactorKey, of: string, reason: string): string {
  const name = FACTOR_TESTS[key].name;
  return reason.trim() ? `Reason for the ${name} of ${of}: ${reason.trim()}` : `Write the reason for the ${name} of ${of} (none yet)`;
}
