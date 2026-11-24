import Link from "next/link";
import SiteHeader from "../../../SiteHeader";
import { loadWebsite } from "../loadWebsite";
import SitePageDetails from "./SitePageDetails";

/** A page id is a UUID; anything else cannot be a page, so it is not looked for. */
const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One page of the website on its own screen (WC-207): its name, address,
 * status, when it was made and last changed, with Edit (name and address),
 * Publish / Back to draft and Delete. The same role check as the list
 * (loadWebsite); a page not found, or a list that could not be read, says so
 * rather than leaving a blank (rule 7).
 */
export default async function WebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadWebsite();
  let problem: { kind: "error" | "note"; text: string } | null = null;
  let page = null;
  if (!load.ok) problem = { kind: load.kind, text: load.problem };
  else if (typeof load.pages === "string") {
    problem = { kind: "error", text: `This page could not be loaded: ${load.pages}. Nothing has been lost; try reloading.` };
  } else {
    page = PAGE_ID.test(id) ? load.pages.find((p) => p.id === id) ?? null : null;
    if (!page) problem = { kind: "error", text: "This page was not found. It may have been deleted, or the link may be wrong." };
  }

  return (
    <>
      <SiteHeader {...load.header} />
      <main>
        <p className="note"><Link href="/admin/website">← Website</Link></p>
        {problem || !page ? (
          <>
            <h1>Page</h1>
            <p className={problem?.kind ?? "error"} role={problem?.kind === "note" ? "status" : "alert"}>{problem?.text}</p>
          </>
        ) : (
          <SitePageDetails page={page} />
        )}
      </main>
    </>
  );
}
