"use client";

/**
 * One page of the website (WC-207): its facts, an Edit form for the name and
 * the address, a Publish / Back to draft switch, Delete with an "are you
 * sure" step, and a link to its section editor (WC-208). Every save shows the
 * page as the database read it back; a save that failed says so and keeps what was typed (engineering rule 6). After a
 * delete it goes back to the page list.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { SITE_PAGE_NAME_MAX, SITE_PAGE_SLUG_MAX, type SitePage } from "../../../../core/website.ts";
import { changePage, deletePage } from "../actions";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";
const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

type Result<T> = { ok: true } & T | { ok: false; error: string };

async function reach<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export default function SitePageDetails({ page: initial }: { page: SitePage }) {
  const router = useRouter();
  const [page, setPage] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function begin() {
    setError(null);
    setNotice(null);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    begin();
    startTransition(async () => {
      const result = await reach(() => changePage(page.id, { name, slug }));
      if (result.ok) {
        setPage(result.page);
        setName(result.page.name);
        setSlug(result.page.slug);
        setEditing(false);
        setNotice(`Saved. The page is now "${result.page.name}" at the address "${result.page.slug}".`);
      } else setError(`Not saved. ${result.error}`);
    });
  }

  function publish(isPublished: boolean) {
    begin();
    startTransition(async () => {
      const result = await reach(() => changePage(page.id, { isPublished }));
      if (result.ok) {
        setPage(result.page);
        setNotice(result.page.isPublished ? "Published." : "Taken back to a draft.");
      } else setError(`Not saved. ${result.error}`);
    });
  }

  function remove() {
    begin();
    startTransition(async () => {
      const result = await reach(() => deletePage(page.id));
      if (result.ok) {
        router.push("/admin/website");
        router.refresh();
      } else {
        setConfirming(false);
        setError(`Not deleted. ${result.error}`);
      }
    });
  }

  const changed = page.updatedAt !== page.createdAt;

  return (
    <section aria-label="Page details">
      <h1>{page.name}</h1>
      <dl className="topic-facts">
        <dt>Name</dt>
        <dd>{page.name}</dd>
        <dt>Address</dt>
        <dd><code>{page.slug}</code></dd>
        <dt>Status</dt>
        <dd>{page.isPublished ? "Published" : "Draft"}</dd>
        <dt>Sections</dt>
        <dd>{page.sections.length === 0 ? <span className="note">None yet.</span> : page.sections.length}</dd>
        <dt>Made</dt>
        <dd><time dateTime={page.createdAt}>{WHEN.format(new Date(page.createdAt))}</time></dd>
        <dt>Last changed</dt>
        <dd>
          {changed ? <time dateTime={page.updatedAt}>{WHEN.format(new Date(page.updatedAt))}</time> : <span className="note">Not changed since it was made.</span>}
        </dd>
      </dl>

      {editing ? (
        <form className="site-page-form" onSubmit={save} aria-label="Edit page" noValidate>
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} type="text" maxLength={SITE_PAGE_NAME_MAX} value={name}
            onChange={(e) => setName(e.target.value)} disabled={pending} />
          <label htmlFor={`${id}-slug`}>Address</label>
          <input id={`${id}-slug`} type="text" maxLength={SITE_PAGE_SLUG_MAX} value={slug}
            onChange={(e) => setSlug(e.target.value)} disabled={pending} aria-describedby={`${id}-slug-help`} />
          <p id={`${id}-slug-help`} className="note">
            Lower-case letters and digits, with single hyphens between words. Leave it blank to keep the page&apos;s address.
          </p>
          <p>
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>{" "}
            <button type="button" disabled={pending}
              onClick={() => { setEditing(false); setName(page.name); setSlug(page.slug); begin(); }}>
              Cancel
            </button>
          </p>
        </form>
      ) : (
        <p>
          <button type="button" disabled={pending} onClick={() => { begin(); setEditing(true); setConfirming(false); }}>Edit</button>{" "}
          <Link className="button" href={`/admin/website/${page.id}/edit`}>Edit sections</Link>{" "}
          <button type="button" disabled={pending} onClick={() => publish(!page.isPublished)}>
            {page.isPublished ? "Back to draft" : "Publish"}
          </button>{" "}
          {!confirming && (
            <button type="button" disabled={pending} onClick={() => { begin(); setConfirming(true); }}>Delete</button>
          )}
        </p>
      )}

      {confirming && !editing && (
        <div role="alertdialog" aria-label="Delete this page?">
          <p>
            Delete the page &quot;{page.name}&quot;? It is removed for good and cannot be brought back.
          </p>
          <p>
            <button type="button" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Yes, delete it"}</button>{" "}
            <button type="button" disabled={pending} onClick={() => setConfirming(false)}>Keep it</button>
          </p>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}
    </section>
  );
}
