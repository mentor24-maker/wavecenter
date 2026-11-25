/**
 * The app's `SitePageStore` (core/website.ts): how core reaches the
 * `site_pages` table. It acts through the signed-in member's own session, so
 * row-level security decides what it may read (published pages; every page
 * for a role with `site.edit`) and add, change (its sections too, WC-208) or
 * delete (a role with `site.edit`), repeating core's rules. Below it, the
 * same for the saved sections reused on many pages (`site_sections`, WC-212).
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core. A save the
 * database refused is thrown, never taken as done (engineering rule 6).
 */
import { CoreError } from "../../core/tool.ts";
import {
  normalizeSavedSectionContent, normalizeSiteSections, sortSavedSections, sortSitePages,
  type SitePage, type SitePageStore, type SiteSavedSection, type SiteSavedSectionStore,
} from "../../core/website.ts";
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

// ── Saved sections (WC-212) ───────────────────────────────────────────────
// The `site_sections` table, through the member's own session: a role with
// `site.edit` reads every original and saves or changes one; anyone else
// reads only an original a published page follows (row-level security).

const SAVED_COLUMNS = "id, name, section, created_by, tool, created_at, updated_at";

function fromSavedRow(r: any): SiteSavedSection {
  return {
    id: r.id, name: r.name, createdBy: r.created_by, tool: r.tool, createdAt: r.created_at, updatedAt: r.updated_at,
    // Whatever is stored is tidied, so a malformed value never breaks a screen.
    section: normalizeSavedSectionContent(r.section),
  };
}

/** Every saved section the member may see, A to Z. A failed read throws, so a screen never mistakes it for "none". */
export async function listSavedSections(supabase: Client): Promise<SiteSavedSection[]> {
  const { data, error } = await supabase.from("site_sections").select(SAVED_COLUMNS);
  if (error) throw new Error(`The database refused to read the saved sections: ${error.message}`);
  return sortSavedSections((data ?? []).map(fromSavedRow));
}

export function supabaseSavedSectionStore(supabase: Client): SiteSavedSectionStore {
  return {
    list: () => listSavedSections(supabase),
    async insert(row) {
      const { data, error } = await supabase.from("site_sections").insert(row).select(SAVED_COLUMNS).maybeSingle();
      if (error?.code === "23514") throw new CoreError("The database refused this section: its name or its size is not allowed. Nothing was saved.");
      if (error) throw new Error(`The database refused to save the reusable section: ${error.message}`);
      return data ? fromSavedRow(data) : null;
    },
    async update(id, patch) {
      const { data, error } = await supabase.from("site_sections").update({ section: patch.section }).eq("id", id).select(SAVED_COLUMNS).maybeSingle();
      if (error?.code === "23514") throw new CoreError("The database refused this section: it is too large. Nothing was saved.");
      if (error) throw new Error(`The database refused to save the change to the saved section: ${error.message}`);
      return data ? fromSavedRow(data) : null;
    },
  };
}
