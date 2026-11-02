/**
 * Joining WaveCenter. Supabase Auth makes the account itself (app/auth/actions.ts
 * `register`), so core's part is what the new account carries: the tool that
 * made it, kept in the account's user metadata. The database credits the new
 * member with `joined_wavecenter` in the same save that makes the account,
 * naming that tool (supabase/migrations/20261102135000_score_joined_wavecenter.sql).
 */
import { requireTool } from './tool.ts';

/** The tool named when an account arrives without one, such as one made with the service key. */
export const ACCOUNT_FALLBACK_TOOL = 'supabase-auth';

/** The user metadata a new account is made with, so joining names `tool`. */
export function newAccountData(tool: string): { tool: string } {
  return { tool: requireTool(tool) };
}
