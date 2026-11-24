"use server";

/**
 * Making a page of the website (WC-206) runs on the server through core
 * (core/website.ts) as the tool `wavecenter`, acting as the signed-in member.
 *
 * Returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { CoreError, WAVECENTER_TOOL } from "../../../core/tool.ts";
import { addSitePage } from "../../../core/website.ts";
import { readRolesAndPermissions, supabaseMemberRoleStore } from "../../lib/memberRoleStore";
import { supabaseSitePageStore } from "../../lib/sitePageStore";
import { currentUser, supabaseForRequest } from "../../lib/supabase";

export type SitePageSaveResult = { ok: true; slug: string } | { ok: false; error: string };

export async function addPage(name: string, slug: string): Promise<SitePageSaveResult> {
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so the page was not saved. Try again in a minute."
          : "You are signed out, so the page was not saved. Reload the page and log in again.",
      };
    }
    const { grants } = await readRolesAndPermissions(supabase);
    const page = await addSitePage(
      { pages: supabaseSitePageStore(supabase), roles: supabaseMemberRoleStore(supabase), grants },
      { actorId: user.id, name, slug },
      WAVECENTER_TOOL,
    );
    revalidatePath("/admin/website");
    return { ok: true, slug: page.slug };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("website: could not save the page:", err);
    return { ok: false, error: "Could not save the page. Nothing was made; try again." };
  }
}
