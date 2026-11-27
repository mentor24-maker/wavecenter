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
 * that failed says so and keeps the sections on screen (rule 6).
 *
 * Each cell of a layout holds modules (WC-209): a heading, text, a picture or
 * a button. Add one to a cell, choose it to edit it in the settings panel
 * beside the sections (ModulePanel), move it up or down its cell or to
 * another cell, or remove it. Modules save with the sections.
 *
 * Saved sections (WC-212): any section can be saved as a reusable section,
 * and a saved one inserted either linked (it follows the original, shown
 * with the original's content, and cannot be edited here, modules included)
 * or as a plain copy. Unlink turns a linked section into a plain copy; Update
 * the original pushes a copy's content to the original, changing every page
 * that follows it at once, and links this section to it again. Those two
 * writes save at once; the page's own list still waits for Save.
 *
 * Beside the Insert picker (WC-246), the picked saved section can be renamed
 * or deleted. Delete first says how many pages follow it and asks; on yes,
 * every page that follows it keeps its content as its own plain copy (core
 * rewrites those pages before it deletes the original), and so does any
 * section here that followed it. Both save at once.
 *
 * Preview (WC-211): Phone, Tablet or Desktop draws the unsaved sections with
 * the public renderer at that device's width (DevicePreview). Each section
 * can be hidden on a phone or on a desktop, and its columns can stack on a
 * phone or stay side by side.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition, type CSSProperties, type MouseEvent } from "react";
import {
  SITE_MODULE_TYPES, SITE_SECTION_ALIGNMENTS, SITE_SECTION_LAYOUTS, SITE_SECTION_SPACING_MAX, SITE_SECTION_TITLE_MAX, SITE_SECTIONS_MAX,
  SITE_SAVED_SECTION_NAME_MAX, SITE_DEVICES,
  copyFollowersOf, insertSavedSection, isLinkedSiteSection, newSiteModule, newSiteSection, pagesFollowing, resolveSiteSections, siteModuleLabel,
  siteModuleProblem, siteModulesInLayout, siteSectionCells, siteSectionChanges, siteSectionGrid, sortSavedSections, unlinkSiteSection,
  type SiteDevice, type SiteModule, type SiteModuleType, type SitePage, type SiteSavedSection, type SiteSection, type SiteSectionLayout,
} from "../../../../../core/website.ts";
import { changeReusable, deleteReusable, renameReusable, saveReusable, saveSections, type SavedSectionDeleteResult, type SavedSectionResult } from "../../actions";
import type { LeaderboardTop } from "../../../../../core/leaderboard.ts";
import SiteModuleView from "../../SiteModuleView";
import DevicePreview from "./DevicePreview";
import ModulePanel from "./ModulePanel";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";
const CELL_NAMES: Record<string, string> = { main: "Main", left: "Left", center: "Middle", right: "Right" };
const cellName = (cell: string) => CELL_NAMES[cell] ?? cell;

function layoutLabel(layout: SiteSectionLayout): string {
  return SITE_SECTION_LAYOUTS.find((l) => l.key === layout)?.label ?? layout;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function SectionEditor({ page: initial, pages, saved: initialSaved, savedProblem, leaderboard }: {
  page: SitePage;
  /** Every page the member sees, to say how many follow a saved section. */
  pages: SitePage[];
  /** The saved sections, A to Z, or none when they could not be read (`savedProblem` says why). */
  saved: SiteSavedSection[];
  savedProblem: string | null;
  /** The leaderboard's top ten, read on the server, for any Leaderboard module (WC-237). */
  leaderboard?: LeaderboardTop;
}) {
  const router = useRouter();
  const [page, setPage] = useState(initial);
  const [sections, setSections] = useState<SiteSection[]>(initial.sections);
  const [newLayout, setNewLayout] = useState<SiteSectionLayout>("single");
  /** The module whose settings panel is open, by id. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** The type each cell's Add module picker shows, by "<section id>/<cell>". */
  const [newType, setNewType] = useState<Record<string, SiteModuleType>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const [saved, setSaved] = useState(initialSaved);
  const [pick, setPick] = useState(initialSaved[0]?.id ?? "");
  const [pickLinked, setPickLinked] = useState(true);
  const [naming, setNaming] = useState<{ sectionId: string; name: string } | null>(null);
  /** The new name being typed for the picked saved section, or null when not renaming (WC-246). */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The "are you sure" step for deleting the picked saved section is showing (WC-246). */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** The screen the preview draws, or null when it is closed. */
  const [device, setDevice] = useState<SiteDevice | null>(null);
  const savedById = useMemo(() => new Map(saved.map((o) => [o.id, o])), [saved]);

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

  /**
   * A new layout for section `i`. A module in a cell the new layout does not
   * have moves to its first cell in the same change, so it never drops off
   * the screen (and an open panel's Cell list still holds its cell).
   */
  function changeLayout(i: number, layout: SiteSectionLayout) {
    update(i, { layout, modules: siteModulesInLayout(sections[i].modules, layout) });
  }

  /** Change module `mid` in section `i` (its settings, or its cell). */
  function updateModule(i: number, next: SiteModule) {
    update(i, { modules: sections[i].modules.map((m) => (m.id === next.id ? next : m)) });
  }

  /** Move module `mid` one place up or down among the modules of its own cell. */
  function moveModule(i: number, mid: string, by: -1 | 1) {
    const list = [...sections[i].modules];
    const at = list.findIndex((m) => m.id === mid);
    if (at < 0) return;
    let j = at + by;
    while (j >= 0 && j < list.length && list[j].cell !== list[at].cell) j += by;
    if (j < 0 || j >= list.length) return;
    [list[at], list[j]] = [list[j], list[at]];
    update(i, { modules: list });
  }

  function removeModule(i: number, mid: string) {
    if (chosen === mid) setChosen(null);
    update(i, { modules: sections[i].modules.filter((m) => m.id !== mid) });
  }

  function addModule(i: number, cell: string) {
    const m = newSiteModule(newType[`${sections[i].id}/${cell}`] ?? "heading", cell, sections);
    update(i, { modules: [...sections[i].modules, m] });
    setChosen(m.id);
  }

  /** The chosen module and where it is, while its panel is open. */
  const open = useMemo(() => {
    for (const [i, s] of sections.entries()) {
      if (isLinkedSiteSection(s)) continue; // a section that follows its original is not edited here
      const m = s.modules.find((x) => x.id === chosen);
      if (m) return { i, m };
    }
    return null;
  }, [sections, chosen]);
  const problems = useMemo(() => sections.flatMap((s) => s.modules).filter((m) => siteModuleProblem(m) !== null).length, [sections]);

  function add() {
    if (full) return;
    edited([...sections, newSiteSection(newLayout, sections)]);
  }

  function insertSaved() {
    const original = savedById.get(pick);
    if (full || !original) return;
    edited([...sections, insertSavedSection(original, pickLinked, sections)]);
  }

  /** How many pages follow saved section `savedId`, counting this one as it is saved. */
  function followers(savedId: string): number {
    return pagesFollowing(pages.map((p) => (p.id === page.id ? page : p)), savedId).length;
  }

  /** Run a saved-section write; on success, take in the new original and relink `sectionId` to it. */
  function savedWrite(sectionId: string, write: () => Promise<SavedSectionResult>, done: (o: SiteSavedSection) => string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      let result: SavedSectionResult;
      try {
        result = await write();
      } catch {
        result = { ok: false, error: UNREACHABLE };
      }
      if (!result.ok) {
        setError(`Not saved. ${result.error} Your sections are still here.`);
        return;
      }
      const original = result.saved;
      const list = sortSavedSections([...saved.filter((o) => o.id !== original.id), original]);
      setSaved(list);
      setPick((p) => p || original.id);
      // Every section that follows it, on screen and in the saved baseline, shows its new content.
      const relinked = sections.map((x) => (x.id === sectionId ? { ...x, savedSectionId: original.id, linked: true } : x));
      const next = resolveSiteSections(relinked, list);
      const baseline = resolveSiteSections(page.sections, list);
      setSections(next);
      setPage((pg) => ({ ...pg, sections: baseline }));
      setNaming(null);
      // Only ask for Save when this page now differs from what it has saved.
      const unsavedNow = siteSectionChanges(baseline, next).length > 0;
      setNotice(`${done(original)}${unsavedNow ? " Click Save to keep that on this page." : ""}`);
    });
  }

  function saveAsReusable(s: SiteSection, name: string) {
    savedWrite(s.id, () => saveReusable(name, s),
      (o) => `Saved "${o.name}" as a reusable section. This section now follows it.`);
  }

  function updateOriginal(s: SiteSection) {
    const original = s.savedSectionId ? savedById.get(s.savedSectionId) : undefined;
    if (!original) return;
    const n = followers(original.id);
    const reach = n ? ` It changes at once on ${plural(n, "page")} that follow it.` : "";
    if (!window.confirm(`Replace the saved section "${original.name}" with this section?${reach}`)) return;
    savedWrite(s.id, () => changeReusable(original.id, s),
      (o) => `Changed "${o.name}" on every page that follows it. This section follows it again.`);
  }

  /** Pick another saved section; any rename or delete step for the last one closes. */
  function choosePick(next: string) {
    setPick(next);
    setRenaming(null);
    setConfirmDelete(false);
  }

  /** Give the picked saved section the name typed (WC-246); the picker and every label here show it at once. */
  function renamePicked() {
    const original = savedById.get(pick);
    if (!original || renaming === null) return;
    const name = renaming;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      let result: SavedSectionResult;
      try {
        result = await renameReusable(original.id, name);
      } catch {
        result = { ok: false, error: UNREACHABLE };
      }
      if (!result.ok) {
        setError(`Not renamed. ${result.error}`);
        return;
      }
      const renamed = result.saved;
      setSaved((list) => sortSavedSections([...list.filter((o) => o.id !== renamed.id), renamed]));
      setRenaming(null);
      setNotice(`Renamed "${original.name}" to "${renamed.name}".`);
    });
  }

  /**
   * Delete the picked saved section, after the "are you sure" step (WC-246).
   * The server turns every page that follows it into a plain copy first; here
   * every section that followed it, on screen and in the saved baseline,
   * becomes the same plain copy, so this page shows no unsaved change for it.
   */
  function deletePicked() {
    const original = savedById.get(pick);
    if (!original) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      let result: SavedSectionDeleteResult;
      try {
        result = await deleteReusable(original.id);
      } catch {
        result = { ok: false, error: UNREACHABLE };
      }
      setConfirmDelete(false);
      if (!result.ok) {
        setError(`Not deleted. ${result.error}`);
        return;
      }
      const list = saved.filter((o) => o.id !== original.id);
      setSaved(list);
      setPick(list[0]?.id ?? "");
      setSections((now) => copyFollowersOf(now, original));
      setPage((pg) => ({ ...pg, sections: copyFollowersOf(pg.sections, original) }));
      const kept = result.pagesCopied
        ? ` ${result.pagesCopied === 1 ? "The 1 page that followed it keeps" : `The ${result.pagesCopied} pages that followed it keep`} its content as their own copy.`
        : "";
      setNotice(`Deleted the saved section "${result.name}".${kept}`);
    });
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
    <section aria-label="Section editor" className={open ? "builder with-panel" : "builder"}>
      <div className="builder-main">
      <p className="note"><Link href={`/admin/website/${page.id}`} onClick={leaving}>← {page.name}</Link></p>
      <h1>Edit sections: {page.name}</h1>
      <p className="note">
        A page is a stack of sections, top to bottom. Each section&apos;s layout splits it into cells, and each
        cell holds modules: headings, text, pictures and buttons. Choose a module to change it in the panel.
        Nothing is saved until you click Save.
      </p>

      <div className="device-switch" role="group" aria-label="Preview">
        <strong>Preview:</strong>
        {SITE_DEVICES.map((d) => (
          <button key={d.key} type="button" aria-pressed={device === d.key} onClick={() => setDevice(d.key)}>{d.label}</button>
        ))}
        {device && <button type="button" onClick={() => setDevice(null)}>Close preview</button>}
      </div>
      {device && <DevicePreview sections={sections} device={device} leaderboard={leaderboard} />}

      {sections.length === 0 && (
        <p className="note" role="status">This page has no sections yet. Pick a layout below and click Add section.</p>
      )}

      <ol className="section-list">
        {sections.map((s, i) => {
          const sid = `${id}-${s.id}`;
          const linked = isLinkedSiteSection(s);
          const original = s.savedSectionId ? savedById.get(s.savedSectionId) : undefined;
          const locked = pending || linked;
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
                {linked && (
                  <span className="note" role="note">
                    {original ? <>Follows the saved section &ldquo;{original.name}&rdquo;</> : "Follows a saved section that could not be found, so it shows its last saved content"}
                  </span>
                )}
                {!linked && s.savedSectionId && (
                  <span className="note">Copy of {original ? <>&ldquo;{original.name}&rdquo;</> : "a saved section that was deleted or could not be found"}</span>
                )}
                <span className="section-moves">
                  <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label={`Move section ${i + 1} up`}>↑ Up</button>{" "}
                  <button type="button" disabled={pending || i === sections.length - 1} onClick={() => move(i, 1)} aria-label={`Move section ${i + 1} down`}>↓ Down</button>{" "}
                  <button type="button" disabled={pending} onClick={() => { if (open?.i === i) setChosen(null); edited(sections.filter((_, j) => j !== i)); }} aria-label={`Remove section ${i + 1}`}>Remove</button>
                </span>
              </div>

              <div className="section-fields">
                <label htmlFor={`${sid}-title`}>Title</label>
                <input id={`${sid}-title`} type="text" maxLength={SITE_SECTION_TITLE_MAX} value={s.title} disabled={locked}
                  placeholder="Optional, for your own reference" onChange={(e) => update(i, { title: e.target.value })} />
                <label htmlFor={`${sid}-layout`}>Layout</label>
                <select id={`${sid}-layout`} value={s.layout} disabled={locked} onChange={(e) => changeLayout(i, e.target.value as SiteSectionLayout)}>
                  {SITE_SECTION_LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
                <label htmlFor={`${sid}-align`}>Alignment</label>
                <select id={`${sid}-align`} value={s.alignment} disabled={locked}
                  onChange={(e) => update(i, { alignment: e.target.value as SiteSection["alignment"] })}>
                  {SITE_SECTION_ALIGNMENTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <label htmlFor={`${sid}-top`}>Space above (pixels)</label>
                <input id={`${sid}-top`} type="number" min={0} max={SITE_SECTION_SPACING_MAX} step={1} value={s.marginTop} disabled={locked}
                  onChange={(e) => update(i, { marginTop: Math.min(Math.max(Math.round(Number(e.target.value) || 0), 0), SITE_SECTION_SPACING_MAX) })} />
                <label htmlFor={`${sid}-bottom`}>Space below (pixels)</label>
                <input id={`${sid}-bottom`} type="number" min={0} max={SITE_SECTION_SPACING_MAX} step={1} value={s.marginBottom} disabled={locked}
                  onChange={(e) => update(i, { marginBottom: Math.min(Math.max(Math.round(Number(e.target.value) || 0), 0), SITE_SECTION_SPACING_MAX) })} />
                <label htmlFor={`${sid}-bg-on`}>Background colour</label>
                <span>
                  <input id={`${sid}-bg-on`} type="checkbox" checked={s.background !== ""} disabled={locked}
                    onChange={(e) => update(i, { background: e.target.checked ? "#ffffff" : "" })} />{" "}
                  {s.background !== "" ? (
                    <input type="color" value={s.background} disabled={locked} aria-label={`Section ${i + 1} background colour`}
                      onChange={(e) => update(i, { background: e.target.value.toLowerCase() })} />
                  ) : (
                    <span className="note">None</span>
                  )}
                </span>
                <span>Screens</span>
                <span>
                  <label>
                    <input type="checkbox" checked={s.hideOnPhone} disabled={locked} onChange={(e) => update(i, { hideOnPhone: e.target.checked })} />{" "}
                    Hide on phone
                  </label>{" "}
                  <label>
                    <input type="checkbox" checked={s.hideOnDesktop} disabled={locked} onChange={(e) => update(i, { hideOnDesktop: e.target.checked })} />{" "}
                    Hide on desktop
                  </label>{" "}
                  {siteSectionCells(s.layout).length > 1 && (
                    <label>
                      <input type="checkbox" checked={s.stackOnPhone} disabled={locked} onChange={(e) => update(i, { stackOnPhone: e.target.checked })} />{" "}
                      Columns stack on a phone
                    </label>
                  )}
                </span>
              </div>

              <div className="section-reuse">
                {linked ? (
                  <>
                    <span className="note">A section that follows its saved original cannot be changed here. </span>
                    <button type="button" disabled={pending} onClick={() => edited(sections.map((x, j) => (j === i ? unlinkSiteSection(x) : x)))}>
                      Unlink
                    </button>
                    <span className="note"> (keeps it as a plain copy you can change)</span>
                  </>
                ) : naming?.sectionId === s.id ? (
                  <>
                    <label htmlFor={`${sid}-save-name`}>Name for the saved section</label>{" "}
                    <input id={`${sid}-save-name`} type="text" maxLength={SITE_SAVED_SECTION_NAME_MAX} value={naming.name} disabled={pending}
                      onChange={(e) => setNaming({ sectionId: s.id, name: e.target.value })} />{" "}
                    <button type="button" disabled={pending || !naming.name.trim()} onClick={() => saveAsReusable(s, naming.name)}>Save as reusable</button>{" "}
                    <button type="button" disabled={pending} onClick={() => setNaming(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={pending} onClick={() => setNaming({ sectionId: s.id, name: s.title })}>Save as a reusable section</button>
                    {original && (
                      <>
                        {" "}
                        <button type="button" disabled={pending} onClick={() => updateOriginal(s)}>Update the original &ldquo;{original.name}&rdquo;</button>
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="section-preview-frame">
                <div className="section-preview" style={style}>
                  {siteSectionCells(s.layout).map((cell) => {
                    const here = s.modules.filter((m) => m.cell === cell);
                    const key = `${s.id}/${cell}`;
                    const where = `section ${i + 1}, ${cellName(cell).toLowerCase()} cell`;
                    return (
                      <div key={cell} className="section-cell" aria-label={`Section ${i + 1}, ${cellName(cell)} cell`}>
                        <strong>{cellName(cell)}</strong>
                        {here.length === 0 && <span className="note">Empty: add a module below.</span>}
                        {here.map((m, k) => {
                          const name = `${siteModuleLabel(m.type)} ${k + 1} in ${where}`;
                          return (
                            <div key={m.id} className={`module-card${chosen === m.id ? " chosen" : ""}${siteModuleProblem(m) ? " has-problem" : ""}`}>
                              <div className="module-head">
                                <span className="note">{siteModuleLabel(m.type)}</span>
                                <span className="section-moves">
                                  <button type="button" disabled={locked} aria-pressed={chosen === m.id} onClick={() => setChosen(chosen === m.id ? null : m.id)} aria-label={`Edit ${name}`}>Edit</button>{" "}
                                  <button type="button" disabled={locked || k === 0} onClick={() => moveModule(i, m.id, -1)} aria-label={`Move ${name} up`}>↑</button>{" "}
                                  <button type="button" disabled={locked || k === here.length - 1} onClick={() => moveModule(i, m.id, 1)} aria-label={`Move ${name} down`}>↓</button>{" "}
                                  <button type="button" disabled={locked} onClick={() => removeModule(i, m.id)} aria-label={`Remove ${name}`}>Remove</button>
                                </span>
                              </div>
                              <SiteModuleView module={m} leaderboard={leaderboard} />
                            </div>
                          );
                        })}
                        <span className="module-add">
                          <select value={newType[key] ?? "heading"} disabled={locked} aria-label={`New module for ${where}`}
                            onChange={(e) => setNewType({ ...newType, [key]: e.target.value as SiteModuleType })}>
                            {SITE_MODULE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </select>{" "}
                          <button type="button" disabled={locked} onClick={() => addModule(i, cell)} aria-label={`Add module to ${where}`}>Add module</button>
                        </span>
                      </div>
                    );
                  })}
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

      <div className="section-add">
        {savedProblem ? (
          <p className="error" role="alert">The saved sections could not be loaded ({savedProblem}), so none can be inserted. Try reloading.</p>
        ) : saved.length === 0 ? (
          <p className="note" role="status">No saved sections yet. Click &ldquo;Save as a reusable section&rdquo; on any section to save one for other pages.</p>
        ) : (
          <p>
            <label htmlFor={`${id}-saved`}>Insert a saved section</label>{" "}
            <select id={`${id}-saved`} value={pick} disabled={pending} onChange={(e) => choosePick(e.target.value)}>
              {saved.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>{" "}
            <label>
              <input type="radio" name={`${id}-saved-how`} checked={pickLinked} disabled={pending || full} onChange={() => setPickLinked(true)} />{" "}
              Linked (follows the original)
            </label>{" "}
            <label>
              <input type="radio" name={`${id}-saved-how`} checked={!pickLinked} disabled={pending || full} onChange={() => setPickLinked(false)} />{" "}
              A plain copy
            </label>{" "}
            <button type="button" disabled={pending || full || !savedById.has(pick)} onClick={insertSaved}>Insert saved section</button>{" "}
            <button type="button" disabled={pending || !savedById.has(pick)} aria-pressed={renaming !== null}
              onClick={() => { setConfirmDelete(false); setRenaming(renaming === null ? savedById.get(pick)?.name ?? "" : null); }}>Rename</button>{" "}
            <button type="button" disabled={pending || !savedById.has(pick)} aria-pressed={confirmDelete}
              onClick={() => { setRenaming(null); setConfirmDelete(!confirmDelete); }}>Delete</button>
          </p>
        )}
        {!savedProblem && renaming !== null && savedById.has(pick) && (
          <p>
            <label htmlFor={`${id}-rename`}>New name for &ldquo;{savedById.get(pick)?.name}&rdquo;</label>{" "}
            <input id={`${id}-rename`} type="text" maxLength={SITE_SAVED_SECTION_NAME_MAX} value={renaming} disabled={pending}
              onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renamePicked(); }} />{" "}
            <button type="button" disabled={pending || !renaming.trim()} onClick={renamePicked}>Save name</button>{" "}
            <button type="button" disabled={pending} onClick={() => setRenaming(null)}>Cancel</button>
          </p>
        )}
        {!savedProblem && confirmDelete && savedById.has(pick) && (() => {
          const name = savedById.get(pick)?.name ?? "";
          const n = followers(pick);
          return (
            <div role="alertdialog" aria-label={`Delete the saved section ${name}?`} className="confirm-step">
              <p>
                {n === 0
                  ? <>No page follows &ldquo;{name}&rdquo;. </>
                  : <>{n === 1 ? "1 page follows" : `${n} pages follow`} &ldquo;{name}&rdquo;. {n === 1 ? "It" : "Each"} will keep its content as its own copy. </>}
                Delete the saved section &ldquo;{name}&rdquo;? This cannot be undone.
              </p>
              <button type="button" disabled={pending} onClick={deletePicked}>{pending ? "Deleting…" : `Yes, delete "${name}"`}</button>{" "}
              <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          );
        })()}
      </div>

      <div className="section-save">
        <button type="button" disabled={pending || !unsaved} onClick={save}>{pending ? "Saving…" : "Save"}</button>{" "}
        <button type="button" disabled={pending || !unsaved} onClick={() => { edited(page.sections); setError(null); }}>Undo unsaved changes</button>
        {unsaved ? (
          <p className="note" role="status">Unsaved: {changes.join(", ")}.</p>
        ) : (
          !notice && <p className="note">Everything is saved.</p>
        )}
      </div>

      {problems > 0 && (
        <p className="error" role="alert">
          {problems === 1 ? "1 module has" : `${problems} modules have`} an address that cannot be saved, marked in red. Fix it, or Save will refuse.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}
      </div>

      {open && (
        <ModulePanel key={open.m.id} module={open.m} where={`Section ${open.i + 1}`} cells={siteSectionCells(sections[open.i].layout)}
          cellName={cellName} disabled={pending} onChange={(next) => updateModule(open.i, next)} onClose={() => setChosen(null)} />
      )}
    </section>
  );
}
