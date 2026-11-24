import Link from "next/link";
import { redirect } from "next/navigation";
import { ROLES } from "../../../core/members.ts";
import { mayManageWebsite } from "../../../core/website.ts";
import { headerPoints } from "../../lib/engagementStore";
import { headerName } from "../../lib/memberProfileStore";
import { headerIsAdmin, myRole, readRolesAndPermissions } from "../../lib/memberRoleStore";
import { listSitePages } from "../../lib/sitePageStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import SiteHeader from "../../SiteHeader";
import WebsitePages from "./WebsitePages";

/**
 * Admin → Website: the website manager, WaveCenter's own page builder
 * (WC-206; the plan is docs/WEBSITE_MANAGER.md). This first slice lists the
 * site's pages (name, address, published or draft) and makes a new one with
 * a name and an address. The editor, publishing and serving pages at their
 * addresses are later tickets.
 *
 * Only a role with "Manage website" (core/website.ts `mayManageWebsite`)
 * may use it. Hiding the link does not stop someone typing the address, so the
 * page checks the role itself; a role that could not be read says so, and so
 * does a list that could not be read (rule 7). Signed-out visitors are sent
 * to sign in.
 */
export default async function Website() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Website</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there is nothing to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
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
  const mayManage = role.error === null && mayManageWebsite(role.value, role.grants);
  const pages = mayManage
    ? await listSitePages(supabase).catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
    : [];

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={points} />
      <main>
        <p className="note"><Link href="/admin">← Admin</Link></p>
        <h1>Website</h1>
        {role.error !== null ? (
          <p className="error" role="alert">Your role could not be loaded: {role.error}. Try reloading the page.</p>
        ) : !mayManage ? (
          <p className="note" role="status">
            Your role, <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>, may not manage the website. Only
            a role with the Manage website permission can.
          </p>
        ) : (
          <>
            <p className="note">
              The pages of WaveCenter&apos;s website. A new page starts as a draft with nothing on it; building a
              page&apos;s sections, publishing it and showing it at its address come next.
            </p>
            <WebsitePages pages={pages} />
          </>
        )}
      </main>
    </>
  );
}
