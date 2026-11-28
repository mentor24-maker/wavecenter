import Link from "next/link";
import { isLinkedSiteSection, isSitePageSlug, publicSitePage, resolveSiteSections, sitePageHasContent, type SitePage } from "../../../core/website.ts";
import { headerPoints, readLeaderboardTop } from "../../lib/engagementStore";
import { headerName } from "../../lib/memberProfileStore";
import { headerIsAdmin } from "../../lib/memberRoleStore";
import { readPublishedSitePage, readSavedSectionsByIds } from "../../lib/sitePageStore";
import { currentUser, supabaseForRequest } from "../../lib/supabase";
import { readRecentlyCompletedModule } from "../../lib/taskReads";
import SiteHeader from "../../SiteHeader";
import SiteSections from "../SiteSections";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/**
 * The published page at `slug`, with every linked section showing its saved
 * original's current content (WC-212's resolveSiteSections), or null when
 * there is none. A failed read throws.
 */
async function readPage(supabase: Client, slug: string): Promise<SitePage | null> {
  const page = publicSitePage(await readPublishedSitePage(supabase, slug), slug);
  if (!page) return null;
  const ids = [...new Set(page.sections.filter(isLinkedSiteSection).map((s) => s.savedSectionId as string))];
  const saved = await readSavedSectionsByIds(supabase, ids);
  return { ...page, sections: resolveSiteSections(page.sections, saved) };
}

/**
 * A published page of the website at its own address, `/site/<address>`
 * (WC-210), for anyone, signed in or not. The page is read with the
 * visitor's own session (never the service key), and row-level security
 * returns published pages only; core checks it again (publicSitePage), so a
 * website manager sees the same page a visitor does, never a draft. A
 * section reused from a saved original (WC-212) shows the original's current
 * content, as in the editor.
 *
 * A draft, an unknown address, or a page that could not be read each say so
 * in words, never a blank screen (rule 7).
 *
 * A page with a Leaderboard module (WC-237) reads the leaderboard's top ten
 * here, on the server, with the visitor's own session. A visitor who is not
 * signed in is never read for: the module shows them only a note to sign in.
 * A page with a Recently completed tasks module (WC-265) reads those tasks the
 * same way, with the same rule.
 */
export default async function PublicSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  const [name, isAdmin, points, read] = await Promise.all([
    supabase && user ? headerName(supabase, user) : null,
    supabase && user ? headerIsAdmin(supabase, user.id) : false,
    supabase && user ? headerPoints(supabase, user.id) : undefined,
    !supabase
      ? { problem: "This copy of WaveCenter has no database settings, so there is no page to show." }
      : isSitePageSlug(slug)
        ? readPage(supabase, slug).then(
            (page) => ({ page }),
            (err: unknown) => {
              // The database's own words stay in the server's log; a visitor gets a plain sentence.
              console.error(`/site/${slug}: the page could not be read:`, err);
              return { problem: "This page could not be loaded just now. Try reloading in a minute." };
            },
          )
        : { page: null },
  ]);
  const page = "page" in read ? read.page : null;
  const hasLeaderboard = Boolean(page?.sections.some((s) => s.modules.some((m) => m.type === "leaderboard")));
  const hasCompleted = Boolean(page?.sections.some((s) => s.modules.some((m) => m.type === "completed_tasks")));
  const visitor = { signedIn: Boolean(user), checkFailed };
  const [leaderboard, completed] = await Promise.all([
    hasLeaderboard ? readLeaderboardTop(supabase, visitor) : undefined,
    hasCompleted ? readRecentlyCompletedModule(supabase, visitor) : undefined,
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
        ) : !sitePageHasContent(read.page.sections) ? (
          <>
            <h1>{read.page.name}</h1>
            <p className="note" role="status">This page has nothing on it yet.</p>
          </>
        ) : (
          <SiteSections sections={read.page.sections} leaderboard={leaderboard} completed={completed} />
        )}
      </main>
    </>
  );
}
