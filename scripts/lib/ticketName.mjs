/**
 * The ticket-name rule (Dane, 2026-11-01): a ticket made from one of his tasks
 * keeps his title word for word, unless it is over 12 words, and then it is
 * condensed to 12 or fewer. Any other name is 6-12 plain words.
 */

export const MIN_WORDS = 6;
export const MAX_WORDS = 12;

/** Words in a name. "6-12" and "sign-in" are one word; a lone ":" or "—" is none. */
export function wordCount(name) {
  return String(name ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Why a name breaks the rule, or null when it is fine. `danes` = his own words. */
export function nameProblem(name, { danes = false } = {}) {
  const n = wordCount(name);
  if (n > MAX_WORDS) {
    return `The name is ${n} words; the limit is ${MAX_WORDS}. ` +
      (danes
        ? "Dane's rule: his title word for word, unless it is over 12 words, and then condensed to 12 or fewer."
        : 'Condense it to 6-12 words; the long sentence belongs in the Goal.');
  }
  if (n < MIN_WORDS && !danes) {
    return `The name is ${n} word(s); a name needs at least ${MIN_WORDS}. ` +
      "If these are Dane's own words, add --name-is-danes.";
  }
  return null;
}
