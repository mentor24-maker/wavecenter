import Link from "next/link";
import SiteHeader from "../../../SiteHeader";
import { loadSitePage } from "./loadPage";
import SitePageDetails from "./SitePageDetails";

/**
 * One page of the website on its own screen (WC-207): its name, address,
 * status, how many sections it has, when it was made and last changed, with
 * Edit (name and address), Edit sections (WC-208), Publish / Back to draft
 * and Delete. A page not found, or a list that could not be read, says so
 * rather than leaving a blank (rule 7).
 */
export default async function WebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadSitePage(id);

  return (
    <>
      <SiteHeader {...load.header} />
      <main>
        <p className="note"><Link href="/admin/website">← Website</Link></p>
        {load.ok ? (
          <SitePageDetails page={load.page} />
        ) : (
          <>
            <h1>Page</h1>
            <p className={load.kind} role={load.kind === "note" ? "status" : "alert"}>{load.problem}</p>
          </>
        )}
      </main>
    </>
  );
}
