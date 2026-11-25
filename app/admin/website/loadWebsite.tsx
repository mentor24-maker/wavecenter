/**
 * What every website manager screen needs (WC-206, WC-207): the signed-in
 * member, the header, whether their role may manage the website, and the
 * site's pages, read through the member's own session so row-level security
 * decides what comes back. Every way it can fail comes back as a plain-words
 * reason for the screen to show, never an empty screen (rule 7). Signed-out
 * visitors are sent to sign in.
 */
import { redirect } from "next/navigation";
import { ROLES } from "../../../core/members.ts";
import { mayManageWebsite, type SitePage } from "../../../core/website.ts";
import { headerPoints, type HeaderPoints } from "../../lib/engagementStore";
import { headerName } from "../../lib/memberProfileStore";
import { headerIsAdmin, myRole, readRolesAndPermissions } from "../../lib/memberRoleStore";
import { listSitePages } from "../../lib/sitePageStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";

export type WebsiteHeader = { name?: string | null; isAdmin?: boolean; points?: HeaderPoints };

export type WebsiteLoad =
  | { ok: false; header: WebsiteHeader; problem: string; kind: "error" | "note" }
  /** `pages` is the reason in words when the list could not be read. */
  | { ok: true; header: WebsiteHeader; pages: SitePage[] | string };

export async function loadWebsite(): Promise<WebsiteLoad> {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && !user && !checkFailed) redirect("/sign-in");
  if (!supabase || !user) {
    return {
      ok: false,
      kind: "error",
      header: {},
      problem: !supabase ? "This copy of WaveCenter has no database settings, so there is nothing to show." : SIGN_IN_CHECK_FAILED,
    };
  }

  const [name, points, isAdmin, role] = await Promise.all([
    headerName(supabase, user),
    headerPoints(supabase, user.id),
    headerIsAdmin(supabase, user.id),
    Promise.all([myRole(supabase, user.id), readRolesAndPermissions(supabase)]).then(
      ([value, lists]) => ({ value, grants: lists.grants, error: null }),
      (err: unknown) => ({ value: null, grants: undefined, error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);
  const header = { name, isAdmin, points };
  if (role.error !== null) {
    return { ok: false, kind: "error", header, problem: `Your role could not be loaded: ${role.error}. Try reloading the page.` };
  }
  if (!mayManageWebsite(role.value, role.grants)) {
    const roleName = ROLES.find((r) => r.key === role.value)?.name ?? role.value;
    return {
      ok: false,
      kind: "note",
      header,
      problem: `Your role, ${roleName}, may not manage the website. Only a role with the Manage website permission can.`,
    };
  }
  const pages = await listSitePages(supabase).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
  return { ok: true, header, pages };
}
