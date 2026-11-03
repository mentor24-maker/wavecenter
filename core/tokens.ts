/**
 * The earned-points tokens: the small coloured discs that will float up to a
 * member's point total in the header when they earn points (Dane,
 * 2026-11-03: "The manager should allow the user to control the size and
 * color of tokens (the rotating discs) and the point levels associated with
 * those sizes"). This file holds what a token size is, the checks a size must
 * pass, and which size a given number of points shows. The animation itself
 * is a later ticket.
 *
 * Who may change the sizes is the role's `game.edit` permission ("Manage game
 * scoring", core/game.ts mayManageScoring), the same as the scoring rules.
 * The sizes are reached through a store a client supplies, and every change
 * names its tool. The database's row-level security repeats who may change
 * them, and its checks repeat the limits here
 * (supabase/migrations/20261103150000_token_settings.sql).
 */
import { mayManageScoring, type GameActor } from './game.ts';
import { CoreError, requireTool } from './tool.ts';

/** The smallest and largest a token may be, in pixels across. The migration checks the same. */
export const TOKEN_DIAMETER_MIN = 8;
export const TOKEN_DIAMETER_MAX = 64;
/** The longest a size's name may be. The migration checks the same. */
export const TOKEN_NAME_MAX = 40;

/** One token size, in core's own names. */
export interface TokenSize {
  id: string;
  name: string;
  /** Pixels across. */
  diameter: number;
  /** `#rrggbb`, lowercase. */
  color: string;
  /** The fewest points that show this size. No two sizes share one. */
  minPoints: number;
  /** The tool that last changed it. */
  tool: string;
  updatedAt: string;
}

/** What an admin sets on a size. */
export type TokenSizeFields = Pick<TokenSize, 'name' | 'diameter' | 'color' | 'minPoints'>;

/** What core needs from storage for the token sizes. */
export interface TokenStore {
  /** Every size, smallest point level first. */
  list(): Promise<TokenSize[]>;
  /** Add a size. Returns it as stored, or null if nothing was written. */
  add(fields: TokenSizeFields, tool: string): Promise<TokenSize | null>;
  /** Change a size. Returns it as stored, or null if there was no such size or nothing was written. */
  change(id: string, fields: TokenSizeFields, tool: string): Promise<TokenSize | null>;
  /** Remove a size. Returns whether a size was removed. */
  remove(id: string): Promise<boolean>;
}

/** A size as an admin typed it: numbers may still be text. */
export interface TokenSizeInput {
  name: unknown;
  diameter: unknown;
  color: unknown;
  minPoints: unknown;
}

function wholeNumber(value: unknown): number | null {
  const n = typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

/** Check a size and put it in the form it is stored in. Throws a plain-words CoreError on anything wrong. */
export function checkTokenSize(input: TokenSizeInput): TokenSizeFields {
  if (typeof input.name !== 'string' || !input.name.trim()) throw new CoreError('Every token size needs a name.');
  const name = input.name.trim();
  if (name.length > TOKEN_NAME_MAX) throw new CoreError(`A token size's name can be at most ${TOKEN_NAME_MAX} characters; this one is ${name.length}.`);
  const diameter = wholeNumber(input.diameter);
  if (diameter === null || diameter < TOKEN_DIAMETER_MIN || diameter > TOKEN_DIAMETER_MAX) {
    throw new CoreError(`A token's size must be a whole number of pixels from ${TOKEN_DIAMETER_MIN} to ${TOKEN_DIAMETER_MAX}.`);
  }
  const color = typeof input.color === 'string' ? input.color.trim().toLowerCase() : '';
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new CoreError('A token\'s colour must be a hex colour like #f59e0b.');
  const minPoints = wholeNumber(input.minPoints);
  if (minPoints === null || minPoints < 1) throw new CoreError('A point level must be a whole number, 1 or more.');
  return { name, diameter, color, minPoints };
}

/**
 * The size a token for `points` shows: the largest size whose point level the
 * amount reaches, or the smallest size when it reaches none. Null only when
 * there are no sizes at all.
 */
export function tokenSizeFor<T extends Pick<TokenSize, 'minPoints'>>(points: number, sizes: readonly T[]): T | null {
  if (!sizes.length) return null;
  const sorted = [...sizes].sort((a, b) => a.minPoints - b.minPoints);
  let chosen = sorted[0];
  for (const s of sorted) if (s.minPoints <= points) chosen = s;
  return chosen;
}

function mayManage(actor: GameActor) {
  if (!mayManageScoring(actor)) throw new CoreError('Only an admin can change the token sizes. Nothing was saved.');
}

function levelTaken(sizes: readonly TokenSize[], minPoints: number, exceptId?: string) {
  const other = sizes.find((s) => s.minPoints === minPoints && s.id !== exceptId);
  if (other) throw new CoreError(`Two sizes cannot share a point level: "${other.name}" already starts at ${minPoints}. Nothing was saved.`);
}

function same(saved: TokenSize, fields: TokenSizeFields) {
  return saved.name === fields.name && saved.diameter === fields.diameter && saved.color === fields.color && saved.minPoints === fields.minPoints;
}

/** Add a token size. Only an admin may. Throws if what comes back is not what was asked for. */
export async function addTokenSize(store: TokenStore, actor: GameActor, input: TokenSizeInput, tool: string): Promise<TokenSize> {
  const named = requireTool(tool);
  mayManage(actor);
  const fields = checkTokenSize(input);
  levelTaken(await store.list(), fields.minPoints);
  const saved = await store.add(fields, named);
  if (!saved || !same(saved, fields)) throw new CoreError('The token size did not save. Try again.');
  return saved;
}

/** Change a token size. Only an admin may. Throws if what comes back is not what was asked for. */
export async function changeTokenSize(store: TokenStore, actor: GameActor, id: string, input: TokenSizeInput, tool: string): Promise<TokenSize> {
  const named = requireTool(tool);
  mayManage(actor);
  const fields = checkTokenSize(input);
  const sizes = await store.list();
  if (!sizes.some((s) => s.id === id)) throw new CoreError('That token size is not there any more. Reload the page to see the sizes as they are now.');
  levelTaken(sizes, fields.minPoints, id);
  const saved = await store.change(id, fields, named);
  if (!saved || saved.id !== id || !same(saved, fields)) throw new CoreError('The token size did not save. It is as it was; try again.');
  return saved;
}

/** Remove a token size. Only an admin may. Throws if nothing was removed. */
export async function removeTokenSize(store: TokenStore, actor: GameActor, id: string, tool: string): Promise<void> {
  requireTool(tool);
  mayManage(actor);
  if (!(await store.remove(id))) throw new CoreError('The token size was not removed. Reload the page and try again.');
}
