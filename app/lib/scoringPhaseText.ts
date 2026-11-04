/**
 * The scoring phase in plain words, for the Admin page and the Game page:
 * provisional, or final since when (in Mountain time, Dane's own) and set by
 * whom (core/game.ts `ScoringPhase`).
 */
import type { ScoringPhase } from "../../core/game.ts";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** "Jan 5, 2027, 3:04 PM MST", or a plain word when no date was kept. */
export function finalWhen(phase: ScoringPhase): string {
  return phase.finalAt ? WHEN.format(new Date(phase.finalAt)) : "a date that was not recorded";
}

/** Who made points final: you, their public name, or a plain stand-in. */
export function finalWho(phase: ScoringPhase, me: string): string {
  if (phase.finalBy && phase.finalBy === me) return "you";
  if (phase.finalByName) return phase.finalByName;
  return phase.finalBy ? "an admin without a public name" : "an admin whose account is gone";
}
