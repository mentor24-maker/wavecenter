import Link from "next/link";
import SiteHeader from "../../../../SiteHeader";
import { loadSitePage } from "../loadPage";
import SectionEditor from "./SectionEditor";

/**
 * Building a page of the website from sections and layouts (WC-208): the
 * section editor, behind the same role check as the rest of the website
 * manager. A page not found, or one that could not be read, says so rather
 * than leaving a blank (rule 7).
 */
export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadSitePage(id);

  return (
    <>
      <SiteHeader {...load.header} />
      <main>
        {load.ok ? (
          <SectionEditor page={load.page} />
        ) : (
          <>
            <p className="note"><Link href="/admin/website">← Website</Link></p>
            <h1>Edit sections</h1>
            <p className={load.kind} role={load.kind === "note" ? "status" : "alert"}>{load.problem}</p>
          </>
        )}
      </main>
    </>
  );
}
