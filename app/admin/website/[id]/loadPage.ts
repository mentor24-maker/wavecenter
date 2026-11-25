/**
 * One page of the website, for the screens that show or edit it (WC-207,
 * WC-208): the same role check as the page list (loadWebsite), then the page
 * itself. A page not found, or a list that could not be read, comes back as
 * a plain-words reason, never a blank screen (rule 7).
 */
import type { SitePage } from "../../../../core/website.ts";
import { loadWebsite, type WebsiteHeader } from "../loadWebsite";

/** A page id is a UUID; anything else cannot be a page, so it is not looked for. */
const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PageLoad =
  /** `pages` is every page the member sees, this one among them. */
  | { ok: true; header: WebsiteHeader; page: SitePage; pages: SitePage[] }
  | { ok: false; header: WebsiteHeader; kind: "error" | "note"; problem: string };

export async function loadSitePage(id: string): Promise<PageLoad> {
  const load = await loadWebsite();
  if (!load.ok) return load;
  if (typeof load.pages === "string") {
    return { ok: false, header: load.header, kind: "error", problem: `This page could not be loaded: ${load.pages}. Nothing has been lost; try reloading.` };
  }
  const page = PAGE_ID.test(id) ? load.pages.find((p) => p.id === id) : undefined;
  if (!page) return { ok: false, header: load.header, kind: "error", problem: "This page was not found. It may have been deleted, or the link may be wrong." };
  return { ok: true, header: load.header, page, pages: load.pages };
}
