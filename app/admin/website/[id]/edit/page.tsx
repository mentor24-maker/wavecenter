import Link from "next/link";
import { resolveSiteSections, type SiteSavedSection } from "../../../../../core/website.ts";
import SiteHeader from "../../../../SiteHeader";
import { listSavedSections } from "../../../../lib/sitePageStore";
import { supabaseForRequest } from "../../../../lib/supabase";
import { loadSitePage } from "../loadPage";
import SectionEditor from "./SectionEditor";

/** The saved sections (WC-212), or why they could not be read, in words. */
async function readSavedSections(): Promise<SiteSavedSection[] | string> {
  const supabase = await supabaseForRequest();
  if (!supabase) return "this copy of WaveCenter has no database settings";
  return listSavedSections(supabase).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
}

/**
 * Building a page of the website from sections and layouts (WC-208): the
 * section editor, behind the same role check as the rest of the website
 * manager. A page not found, or one that could not be read, says so rather
 * than leaving a blank (rule 7). Every linked section is shown with its saved
 * original's current content (WC-212, resolveSiteSections); if the saved
 * sections could not be read, the editor says so and offers none.
 */
export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadSitePage(id);
  const saved = load.ok ? await readSavedSections() : [];
  const savedList = typeof saved === "string" ? [] : saved;

  return (
    <>
      <SiteHeader {...load.header} />
      <main>
        {load.ok ? (
          <SectionEditor
            page={{ ...load.page, sections: resolveSiteSections(load.page.sections, savedList) }}
            pages={load.pages}
            saved={savedList}
            savedProblem={typeof saved === "string" ? saved : null}
          />
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
