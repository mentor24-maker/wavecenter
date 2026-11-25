import Link from "next/link";
import { publicSitePage, isSitePageSlug } from "../../../core/website.ts";
import { headerPoints } from "../../lib/engagementStore";
import { headerName } from "../../lib/memberProfileStore";
import { headerIsAdmin } from "../../lib/memberRoleStore";
import { readPublishedSitePage } from "../../lib/sitePageStore";
import { currentUser, supabaseForRequest } from "../../lib/supabase";
import SiteHeader from "../../SiteHeader";
import SiteSections from "../SiteSections";

/**
 * A published page of the website at its own address, `/site/<address>`
 * (WC-210), for anyone, signed in or not. The page is read with the
 * visitor's own session (never the service key), and row-level security
 * returns published pages only; core checks it again (publicSitePage), so a
 * website manager sees the same page a visitor does, never a draft.
 *
 * A draft, an unknown address, or a page that could not be read each say so
 * in words, never a blank screen (rule 7).
 */
export default async function PublicSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await supabaseForRequest();
  const { user } = supabase ? await currentUser(supabase) : { user: null };
  const [name, isAdmin, points, read] = await Promise.all([
    supabase && user ? headerName(supabase, user) : null,
    supabase && user ? headerIsAdmin(supabase, user.id) : false,
    supabase && user ? headerPoints(supabase, user.id) : undefined,
    !supabase
      ? { problem: "This copy of WaveCenter has no database settings, so there is no page to show." }
      : isSitePageSlug(slug)
        ? readPublishedSitePage(supabase, slug).then(
            (page) => ({ page: publicSitePage(page, slug) }),
            (err: unknown) => ({ problem: `This page could not be loaded: ${err instanceof Error ? err.message : String(err)}. Try reloading in a minute.` }),
          )
        : { page: null },
  ]);

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={points} />
      <main>
        {"problem" in read ? (
          <>
            <h1>Page</h1>
            <p className="error" role="alert">{read.problem}</p>
          </>
        ) : !read.page ? (
          <>
            <h1>No such page</h1>
            <p className="note" role="status">There is no page at this address.</p>
            <p><Link href="/">← Home</Link></p>
          </>
        ) : read.page.sections.length === 0 ? (
          <>
            <h1>{read.page.name}</h1>
            <p className="note" role="status">This page has nothing on it yet.</p>
          </>
        ) : (
          <SiteSections sections={read.page.sections} />
        )}
      </main>
    </>
  );
}
