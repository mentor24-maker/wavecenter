import Link from "next/link";
import SiteHeader from "../../SiteHeader";
import { loadWebsite } from "./loadWebsite";
import WebsitePages from "./WebsitePages";

/**
 * Admin → Website: the website manager, WaveCenter's own page builder
 * (WC-206; the plan is docs/WEBSITE_MANAGER.md). It lists the site's pages
 * (name, address, published or draft) and makes a new one with a name and an
 * address; a page's name opens its details screen (WC-207), where its
 * sections are edited (app/admin/website/[id], WC-208 onward). Published
 * pages are served at /site/<slug> (app/site/[slug], #204).
 *
 * Only a role with "Manage website" (core/website.ts `mayManageWebsite`)
 * may use it. Hiding the link does not stop someone typing the address, so the
 * page checks the role itself (loadWebsite); a role that could not be read
 * says so, and so does a list that could not be read (rule 7).
 */
export default async function Website() {
  const load = await loadWebsite();
  return (
    <>
      <SiteHeader {...load.header} />
      <main>
        <p className="note"><Link href="/admin">← Admin</Link></p>
        <h1>Website</h1>
        {!load.ok ? (
          <p className={load.kind} role={load.kind === "error" ? "alert" : "status"}>{load.problem}</p>
        ) : (
          <>
            <p className="note">
              The pages of WaveCenter&apos;s website. A new page starts as a draft with nothing on it. Click a
              page&apos;s name to rename it, change its address, publish it or delete it. Building a page&apos;s
              sections and showing it at its address come next.
            </p>
            <WebsitePages pages={load.pages} />
          </>
        )}
      </main>
    </>
  );
}
