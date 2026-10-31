"use server";

/**
 * Making, changing and deleting teams and their member lists, run on the
 * server through core (core/teams.ts) as the tool `wavecenter`.
 *
 * Returns `{ ok: true }` only after the database confirmed the change.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it without calling anything saved (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import {
  addTeamMember, createTeam, deleteTeam, removeTeamMember, updateTeam, type TeamDeps, type TeamInput,
} from "../../core/teams.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { readRolesAndPermissions, supabaseMemberRoleStore } from "../lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";
import { supabaseTeamStore } from "../lib/teamStore";

export type TeamSaveResult = { ok: true } | { ok: false; error: string };

/** Sign-in check, then the change through core; every failure in plain words. */
async function run(what: string, change: (deps: TeamDeps, actorId: string) => Promise<unknown>): Promise<TeamSaveResult> {
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? `WaveCenter could not check that you are signed in, so the ${what} did not happen. Try again in a minute.`
          : `You are signed out, so the ${what} did not happen. Reload the page and log in again.`,
      };
    }
    const { grants } = await readRolesAndPermissions(supabase);
    await change({ teams: supabaseTeamStore(supabase), roles: supabaseMemberRoleStore(supabase), grants }, user.id);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`teams: the ${what} failed:`, err);
    return { ok: false, error: `The ${what} did not happen. Nothing was saved; try again.` };
  }
  revalidatePath("/teams");
  return { ok: true };
}

export async function createTeamAction(input: TeamInput): Promise<TeamSaveResult> {
  return run("new team", (deps, actorId) => createTeam(deps, { actorId, ...input }, WAVECENTER_TOOL));
}

export async function updateTeamAction(teamId: string, input: TeamInput): Promise<TeamSaveResult> {
  return run("change to the team", (deps, actorId) => updateTeam(deps, { actorId, teamId, ...input }, WAVECENTER_TOOL));
}

export async function deleteTeamAction(teamId: string): Promise<TeamSaveResult> {
  return run("delete", (deps, actorId) => deleteTeam(deps, { actorId, teamId }, WAVECENTER_TOOL));
}

export async function addTeamMemberAction(teamId: string, memberId: string): Promise<TeamSaveResult> {
  return run("add", (deps, actorId) => addTeamMember(deps, { actorId, teamId, memberId }, WAVECENTER_TOOL));
}

export async function removeTeamMemberAction(teamId: string, memberId: string): Promise<TeamSaveResult> {
  return run("removal", (deps, actorId) => removeTeamMember(deps, { actorId, teamId, memberId }, WAVECENTER_TOOL));
}
