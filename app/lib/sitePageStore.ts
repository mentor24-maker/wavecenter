/**
 * The app's `SitePageStore` (core/website.ts): how core reaches the
 * `site_pages` table. It acts through the signed-in member's own session, so
 * row-level security decides what it may read (published pages; every page
 * for a role with `site.edit`) and add (a role with `site.edit`), repeating
 * core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core. A save the
 * database refused is thrown, never taken as done (engineering rule 6).
 */
import { CoreError } from "../../core/tool.ts";
import { sortSitePages, type SitePage, type SitePageStore } from "../../core/website.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS = "id, name, slug, is_published, created_by, tool, created_at, updated_at";

function fromRow(r: any): SitePage {
  return {
    id: r.id, name: r.name, slug: r.slug, isPublished: r.is_published === true, createdBy: r.created_by,
    tool: r.tool, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Every page the member may see, A to Z. A failed read throws, so a page never mistakes it for "none". */
export async function listSitePages(supabase: Client): Promise<SitePage[]> {
  const { data, error } = await supabase.from("site_pages").select(COLUMNS);
  if (error) throw new Error(`The database refused to read the website's pages: ${error.message}`);
  return sortSitePages((data ?? []).map(fromRow));
}

export function supabaseSitePageStore(supabase: Client): SitePageStore {
  return {
    list: () => listSitePages(supabase),
    async insert(row) {
      const { data, error } = await supabase.from("site_pages").insert(row).select(COLUMNS).maybeSingle();
      // 23505: the unique address rule. Someone made a page at this address a moment ago.
      if (error?.code === "23505") throw new CoreError(`The address "${row.slug}" is already used by another page. Pick another address.`);
      if (error) throw new Error(`The database refused to save the page: ${error.message}`);
      return data ? fromRow(data) : null;
    },
  };
}
