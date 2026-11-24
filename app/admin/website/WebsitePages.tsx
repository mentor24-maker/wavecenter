"use client";

/**
 * The website manager's page list (WC-206): a fold-out "New page" box (name
 * and address) over a table of the site's pages, A to Z, each with its
 * address and whether it is published or a draft.
 *
 * A save shows its error and keeps what was typed (engineering rule 6); an
 * empty table says it is empty and how to fill it, and a list that could not
 * be read says so (rule 7).
 */
import { useId, useState, useTransition, type FormEvent } from "react";
import { SITE_PAGE_NAME_MAX, SITE_PAGE_SLUG_MAX, sitePageSlug, type SitePage } from "../../../core/website.ts";
import { addPage, type SitePageSaveResult } from "./actions";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again; what you typed is still here.";
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });

export default function WebsitePages({ pages }: { pages: SitePage[] | string }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const typed = { name, slug };
    startTransition(async () => {
      let result: SitePageSaveResult;
      try {
        result = await addPage(typed.name, typed.slug);
      } catch {
        result = { ok: false, error: UNREACHABLE };
      }
      if (result.ok) {
        setName("");
        setSlug("");
        setNotice(`Made the page "${typed.name.trim()}" at the address "${result.slug}". It is a draft.`);
      } else setError(`Not saved. ${result.error}`);
    });
  }

  return (
    <section aria-label="Pages">
      <h2>Pages</h2>
      <details className="forum-add">
        <summary>New page</summary>
        <form className="site-page-form" onSubmit={submit} aria-label="New page" noValidate>
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} type="text" maxLength={SITE_PAGE_NAME_MAX} value={name} placeholder="About us"
            onChange={(e) => setName(e.target.value)} disabled={pending} />
          <label htmlFor={`${id}-slug`}>Address</label>
          <input id={`${id}-slug`} type="text" maxLength={SITE_PAGE_SLUG_MAX} value={slug}
            placeholder={name.trim() ? sitePageSlug(name) : "about-us"}
            onChange={(e) => setSlug(e.target.value)} disabled={pending} aria-describedby={`${id}-slug-help`} />
          <p id={`${id}-slug-help`} className="note">
            Lower-case letters and digits, with single hyphens between words. Leave it blank to make it from the name.
          </p>
          <button type="submit" disabled={pending}>{pending ? "Making…" : "Make page"}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="note" role="status">{notice}</p>}
      </details>
      {typeof pages === "string" ? (
        <p className="error" role="alert">
          The pages could not be read: {pages}. Nothing has been lost; try reloading the page.
        </p>
      ) : (
        <table className="game members">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Address</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Made</th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 ? (
              <tr>
                <td colSpan={4} className="note">
                  No pages yet. Open New page above, give it a name and an address, and click Make page.
                </td>
              </tr>
            ) : (
              pages.map((page) => (
                <tr key={page.id}>
                  <td title={page.name}>{page.name}</td>
                  <td><code>{page.slug}</code></td>
                  <td>{page.isPublished ? "Published" : "Draft"}</td>
                  <td className="num note">
                    <time dateTime={page.createdAt}>{DATE.format(new Date(page.createdAt))}</time>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
