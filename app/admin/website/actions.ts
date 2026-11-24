"use server";

/**
 * Making a page of the website (WC-206), and changing, publishing or
 * deleting one (WC-207), runs on the server through core
 * (core/website.ts) as the tool `wavecenter`, acting as the signed-in member.
 *
 * Returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { CoreError, WAVECENTER_TOOL } from "../../../core/tool.ts";
import { addSitePage, changeSitePage, deleteSitePage, type SitePage, type SitePageDeps } from "../../../core/website.ts";
import { readRolesAndPermissions, supabaseMemberRoleStore } from "../../lib/memberRoleStore";
import { supabaseSitePageStore } from "../../lib/sitePageStore";
import { currentUser, supabaseForRequest } from "../../lib/supabase";

export type SitePageSaveResult = { ok: true; slug: string } | { ok: false; error: string };
export type SitePageChangeResult = { ok: true; page: SitePage } | { ok: false; error: string };

type Acting = { ok: true; deps: SitePageDeps; actorId: string } | { ok: false; error: string };

/** The signed-in member and the stores core needs, or why the write cannot go ahead. */
async function acting(nothing: string): Promise<Acting> {
  const supabase = await supabaseForRequest();
  if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
  const { user, checkFailed } = await currentUser(supabase);
  if (!user) {
    return {
      ok: false,
      error: checkFailed
        ? `WaveCenter could not check that you are signed in, so ${nothing}. Try again in a minute.`
        : `You are signed out, so ${nothing}. Reload the page and log in again.`,
    };
  }
  const { grants } = await readRolesAndPermissions(supabase);
  return { ok: true, actorId: user.id, deps: { pages: supabaseSitePageStore(supabase), roles: supabaseMemberRoleStore(supabase), grants } };
}

export async function addPage(name: string, slug: string): Promise<SitePageSaveResult> {
  try {
    const who = await acting("the page was not saved");
    if (!who.ok) return who;
    const page = await addSitePage(who.deps, { actorId: who.actorId, name, slug }, WAVECENTER_TOOL);
    revalidatePath("/admin/website");
    return { ok: true, slug: page.slug };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("website: could not save the page:", err);
    return { ok: false, error: "Could not save the page. Nothing was made; try again." };
  }
}

/** Change page `id`: any of its name, its address and whether it is published (WC-207). */
export async function changePage(
  id: string,
  change: { name?: string; slug?: string; isPublished?: boolean },
): Promise<SitePageChangeResult> {
  try {
    const who = await acting("the change was not saved");
    if (!who.ok) return who;
    const page = await changeSitePage(
      who.deps,
      { actorId: who.actorId, id, name: change.name, slug: change.slug, isPublished: change.isPublished },
      WAVECENTER_TOOL,
    );
    revalidatePath("/admin/website");
    revalidatePath(`/admin/website/${id}`);
    return { ok: true, page };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("website: could not change the page:", err);
    return { ok: false, error: "Could not save the change. The page is as it was; try again." };
  }
}

/** Delete page `id` (WC-207). */
export async function deletePage(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const who = await acting("the page was not deleted");
    if (!who.ok) return who;
    await deleteSitePage(who.deps, { actorId: who.actorId, id }, WAVECENTER_TOOL);
    revalidatePath("/admin/website");
    return { ok: true };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("website: could not delete the page:", err);
    return { ok: false, error: "Could not delete the page. It is still there; try again." };
  }
}
