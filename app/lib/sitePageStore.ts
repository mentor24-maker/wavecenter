/**
 * The app's `SitePageStore` (core/website.ts): how core reaches the
 * `site_pages` table. It acts through the signed-in member's own session, so
 * row-level security decides what it may read (published pages; every page
 * for a role with `site.edit`) and add, change (its sections too, WC-208) or
 * delete (a role with `site.edit`), repeating core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core. A save the
 * database refused is thrown, never taken as done (engineering rule 6).
 */
import { CoreError } from "../../core/tool.ts";
import { normalizeSiteSections, sortSitePages, type SitePage, type SitePageStore } from "../../core/website.ts";
import type { supabaseForRequest } from "./supabase";
import { TOOL_HEADER } from "./taskStore";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS = "id, name, slug, is_published, layout_sections, created_by, tool, created_at, updated_at";

function fromRow(r: any): SitePage {
  return {
    id: r.id, name: r.name, slug: r.slug, isPublished: r.is_published === true, createdBy: r.created_by,
    tool: r.tool, createdAt: r.created_at, updatedAt: r.updated_at,
    // Whatever is stored is tidied into a well-formed list, so a malformed value never breaks a screen (WC-208).
    sections: normalizeSiteSections(r.layout_sections),
  };
}

/** Every page the member may see, A to Z. A failed read throws, so a page never mistakes it for "none". */
export async function listSitePages(supabase: Client): Promise<SitePage[]> {
  const { data, error } = await supabase.from("site_pages").select(COLUMNS);
  if (error) throw new Error(`The database refused to read the website's pages: ${error.message}`);
  return sortSitePages((data ?? []).map(fromRow));
}

/**
 * The published page at this address, or null when there is none (WC-210).
 * Asks for published rows only, so a website manager's session, which may read
 * drafts, sees the same public page as a visitor. A failed read throws, so the
 * screen never mistakes it for "no such page".
 */
export async function readPublishedSitePage(supabase: Client, slug: string): Promise<SitePage | null> {
  const { data, error } = await supabase.from("site_pages").select(COLUMNS).eq("slug", slug).eq("is_published", true).maybeSingle();
  if (error) throw new Error(`The database refused to read this page: ${error.message}`);
  return data ? fromRow(data) : null;
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
    async update(id, patch, tool) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.slug !== undefined) row.slug = patch.slug;
      if (patch.isPublished !== undefined) row.is_published = patch.isPublished;
      if (patch.sections !== undefined) row.layout_sections = patch.sections;
      // The tool goes in a header: publishing a page earns "Published a page" naming it (WC-213).
      const { data, error } = await supabase.from("site_pages").update(row).eq("id", id).select(COLUMNS).setHeader(TOOL_HEADER, tool).maybeSingle();
      if (error?.code === "23505") throw new CoreError(`The address "${patch.slug}" is already used by another page. Pick another address.`);
      // 23514: a check failed, here the limit on how many sections, or how large, a page may hold.
      if (error?.code === "23514" && patch.sections !== undefined) throw new CoreError("The database refused these sections: a page holds too many, or they are too large. Nothing was saved.");
      if (error) throw new Error(`The database refused to save the change: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async remove(id) {
      const { data, error } = await supabase.from("site_pages").delete().eq("id", id).select("id");
      if (error) throw new Error(`The database refused to delete the page: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
