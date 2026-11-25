"use client";

/**
 * The section editor (WC-208), ported from Normie's
 * components/admin-builder-editor.tsx and trimmed to this step: a page is a
 * stack of sections; each has a layout, an alignment, space above and below
 * and a background colour. An admin adds a section, picks its layout, moves
 * it up or down, removes it, and saves the whole list. The rules (the shape,
 * the limits, who may) are core's (core/website.ts).
 *
 * Nothing is saved until Save. While anything is unsaved the screen names
 * it ("1 section added, the order changed"), and leaving asks first. A save
 * that failed says so and keeps the sections on screen (rule 6). Each cell
 * of a layout shows where modules will go (WC-209).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition, type CSSProperties, type MouseEvent } from "react";
import {
  SITE_SECTION_ALIGNMENTS, SITE_SECTION_LAYOUTS, SITE_SECTION_SPACING_MAX, SITE_SECTION_TITLE_MAX, SITE_SECTIONS_MAX,
  newSiteSection, siteSectionCells, siteSectionChanges, siteSectionGrid,
  type SitePage, type SiteSection, type SiteSectionLayout,
} from "../../../../../core/website.ts";
import { saveSections } from "../../actions";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";
const CELL_NAMES: Record<string, string> = { main: "Main", left: "Left", center: "Middle", right: "Right" };

function layoutLabel(layout: SiteSectionLayout): string {
  return SITE_SECTION_LAYOUTS.find((l) => l.key === layout)?.label ?? layout;
}

export default function SectionEditor({ page: initial }: { page: SitePage }) {
  const router = useRouter();
  const [page, setPage] = useState(initial);
  const [sections, setSections] = useState<SiteSection[]>(initial.sections);
  const [newLayout, setNewLayout] = useState<SiteSectionLayout>("single");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const changes = useMemo(() => siteSectionChanges(page.sections, sections), [page.sections, sections]);
  const unsaved = changes.length > 0;
  const full = sections.length >= SITE_SECTIONS_MAX;

  // Closing the tab or reloading with unsaved sections asks first.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  function edited(next: SiteSection[]) {
    setSections(next);
    setNotice(null);
  }

  function update(i: number, patch: Partial<SiteSection>) {
    edited(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    edited(next);
  }

  function add() {
    if (full) return;
    edited([...sections, newSiteSection(newLayout, sections)]);
  }

  function save() {
    setError(null);
    setNotice(null);
    const sent = sections;
    startTransition(async () => {
      let result;
      try {
        result = await saveSections(page.id, sent);
      } catch {
        result = { ok: false as const, error: UNREACHABLE };
      }
      if (result.ok) {
        setPage(result.page);
        setSections(result.page.sections);
        setNotice(`Saved. The page has ${result.page.sections.length === 1 ? "1 section" : `${result.page.sections.length} sections`}.`);
        router.refresh();
      } else {
        setError(`Not saved. ${result.error} Your sections are still here.`);
      }
    });
  }

  /** Leaving by the back link with unsaved sections asks first. */
  function leaving(e: MouseEvent) {
    if (unsaved && !window.confirm(`Leave without saving? Unsaved: ${changes.join(", ")}.`)) e.preventDefault();
  }

  return (
    <section aria-label="Section editor">
      <p className="note"><Link href={`/admin/website/${page.id}`} onClick={leaving}>← {page.name}</Link></p>
      <h1>Edit sections: {page.name}</h1>
      <p className="note">
        A page is a stack of sections, top to bottom. Each section&apos;s layout splits it into cells; modules
        (headings, text, pictures, buttons) go in the cells in the next step. Nothing is saved until you click Save.
      </p>

      {sections.length === 0 && (
        <p className="note" role="status">This page has no sections yet. Pick a layout below and click Add section.</p>
      )}

      <ol className="section-list">
        {sections.map((s, i) => {
          const sid = `${id}-${s.id}`;
          const style: CSSProperties = {
            gridTemplateColumns: siteSectionGrid(s.layout),
            textAlign: s.alignment,
            marginTop: s.marginTop,
            marginBottom: s.marginBottom,
            background: s.background || undefined,
          };
          return (
            <li key={s.id} className="section-card" aria-label={`Section ${i + 1}${s.title ? `: ${s.title}` : ""}`}>
              <div className="section-head">
                <strong>Section {i + 1}</strong>
                <span className="note">{layoutLabel(s.layout)}</span>
                <span className="section-moves">
                  <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label={`Move section ${i + 1} up`}>↑ Up</button>{" "}
                  <button type="button" disabled={pending || i === sections.length - 1} onClick={() => move(i, 1)} aria-label={`Move section ${i + 1} down`}>↓ Down</button>{" "}
                  <button type="button" disabled={pending} onClick={() => edited(sections.filter((_, j) => j !== i))} aria-label={`Remove section ${i + 1}`}>Remove</button>
                </span>
              </div>

              <div className="section-fields">
                <label htmlFor={`${sid}-title`}>Title</label>
                <input id={`${sid}-title`} type="text" maxLength={SITE_SECTION_TITLE_MAX} value={s.title} disabled={pending}
                  placeholder="Optional, for your own reference" onChange={(e) => update(i, { title: e.target.value })} />
                <label htmlFor={`${sid}-layout`}>Layout</label>
                <select id={`${sid}-layout`} value={s.layout} disabled={pending} onChange={(e) => update(i, { layout: e.target.value as SiteSectionLayout })}>
                  {SITE_SECTION_LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
                <label htmlFor={`${sid}-align`}>Alignment</label>
                <select id={`${sid}-align`} value={s.alignment} disabled={pending}
                  onChange={(e) => update(i, { alignment: e.target.value as SiteSection["alignment"] })}>
                  {SITE_SECTION_ALIGNMENTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <label htmlFor={`${sid}-top`}>Space above (pixels)</label>
                <input id={`${sid}-top`} type="number" min={0} max={SITE_SECTION_SPACING_MAX} step={1} value={s.marginTop} disabled={pending}
                  onChange={(e) => update(i, { marginTop: Math.min(Math.max(Math.round(Number(e.target.value) || 0), 0), SITE_SECTION_SPACING_MAX) })} />
                <label htmlFor={`${sid}-bottom`}>Space below (pixels)</label>
                <input id={`${sid}-bottom`} type="number" min={0} max={SITE_SECTION_SPACING_MAX} step={1} value={s.marginBottom} disabled={pending}
                  onChange={(e) => update(i, { marginBottom: Math.min(Math.max(Math.round(Number(e.target.value) || 0), 0), SITE_SECTION_SPACING_MAX) })} />
                <label htmlFor={`${sid}-bg-on`}>Background colour</label>
                <span>
                  <input id={`${sid}-bg-on`} type="checkbox" checked={s.background !== ""} disabled={pending}
                    onChange={(e) => update(i, { background: e.target.checked ? "#ffffff" : "" })} />{" "}
                  {s.background !== "" ? (
                    <input type="color" value={s.background} disabled={pending} aria-label={`Section ${i + 1} background colour`}
                      onChange={(e) => update(i, { background: e.target.value.toLowerCase() })} />
                  ) : (
                    <span className="note">None</span>
                  )}
                </span>
              </div>

              <div className="section-preview-frame">
                <div className="section-preview" style={style}>
                  {siteSectionCells(s.layout).map((cell) => (
                    <div key={cell} className="section-cell">
                      <strong>{CELL_NAMES[cell] ?? cell}</strong>
                      <span className="note">Empty: modules will go here.</span>
                    </div>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="section-add">
        <label htmlFor={`${id}-new-layout`}>New section&apos;s layout</label>{" "}
        <select id={`${id}-new-layout`} value={newLayout} disabled={pending || full} onChange={(e) => setNewLayout(e.target.value as SiteSectionLayout)}>
          {SITE_SECTION_LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>{" "}
        <button type="button" disabled={pending || full} onClick={add}>Add section</button>
        {full && <span className="note"> A page holds at most {SITE_SECTIONS_MAX} sections.</span>}
      </p>

      <div className="section-save">
        <button type="button" disabled={pending || !unsaved} onClick={save}>{pending ? "Saving…" : "Save"}</button>{" "}
        <button type="button" disabled={pending || !unsaved} onClick={() => { edited(page.sections); setError(null); }}>Undo unsaved changes</button>
        {unsaved ? (
          <p className="note" role="status">Unsaved: {changes.join(", ")}.</p>
        ) : (
          !notice && <p className="note">Everything is saved.</p>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}
    </section>
  );
}
