"use client";

/**
 * The settings panel for one module (WC-209), StarCaster's doctrine of one
 * panel per module: the editor shows it beside the sections while a module is
 * chosen. Each type has its own fields; the module's cell can be changed here
 * too. A picture address or link that cannot be saved is named in plain words
 * as it is typed (core/website.ts, siteModuleProblem), and Save refuses it the
 * same way.
 */
import { useId, useState } from "react";
import {
  SITE_ADDRESS_MAX, SITE_BUTTON_LABEL_MAX, SITE_HEADING_LEVELS, SITE_HEADING_MAX, SITE_IMAGE_ALT_MAX, SITE_IMAGE_WIDTH_MIN, SITE_TEXT_MAX,
  siteImageWidth, siteModuleLabel, siteModuleProblem, type SiteModule,
} from "../../../../../core/website.ts";
import CommentEditor from "../../../../tasks/CommentEditor";

export default function ModulePanel({
  module: m, where, cells, cellName, disabled, onChange, onClose,
}: {
  module: SiteModule;
  /** Which section it is in, in words ("Section 2"). */
  where: string;
  cells: readonly string[];
  cellName: (cell: string) => string;
  disabled: boolean;
  onChange: (next: SiteModule) => void;
  onClose: () => void;
}) {
  const id = useId();
  const problem = siteModuleProblem(m);
  /** The picture width as typed, while the box is being edited; tidied when it is left. */
  const [widthTyped, setWidthTyped] = useState<string | null>(null);
  const set = (settings: Partial<SiteModule["settings"]>) => onChange({ ...m, settings: { ...m.settings, ...settings } } as SiteModule);

  return (
    <aside className="module-panel" aria-label={`${siteModuleLabel(m.type)} settings`}>
      <div className="section-head">
        <strong>{siteModuleLabel(m.type)}</strong>
        <span className="note">{where}</span>
        <span className="section-moves"><button type="button" onClick={onClose}>Done</button></span>
      </div>

      <div className="section-fields module-fields">
        <label htmlFor={`${id}-cell`}>Cell</label>
        <select id={`${id}-cell`} value={m.cell} disabled={disabled || cells.length < 2} onChange={(e) => onChange({ ...m, cell: e.target.value })}>
          {cells.map((c) => <option key={c} value={c}>{cellName(c)}</option>)}
        </select>

        {m.type === "heading" && (
          <>
            <label htmlFor={`${id}-text`}>Words</label>
            <input id={`${id}-text`} type="text" maxLength={SITE_HEADING_MAX} value={m.settings.text} disabled={disabled} autoFocus
              onChange={(e) => set({ text: e.target.value })} />
            <label htmlFor={`${id}-level`}>Size</label>
            <select id={`${id}-level`} value={m.settings.level} disabled={disabled}
              onChange={(e) => set({ level: e.target.value as (typeof SITE_HEADING_LEVELS)[number]["key"] })}>
              {SITE_HEADING_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
            <label htmlFor={`${id}-color-on`}>Own colour</label>
            <span>
              <input id={`${id}-color-on`} type="checkbox" checked={m.settings.color !== ""} disabled={disabled}
                onChange={(e) => set({ color: e.target.checked ? "#18324a" : "" })} />{" "}
              {m.settings.color !== "" ? (
                <input type="color" value={m.settings.color} disabled={disabled} aria-label="Heading colour"
                  onChange={(e) => set({ color: e.target.value.toLowerCase() })} />
              ) : (
                <span className="note">The page&apos;s own</span>
              )}
            </span>
          </>
        )}

        {m.type === "leaderboard" && (
          <>
            <label htmlFor={`${id}-heading`}>Heading</label>
            <input id={`${id}-heading`} type="text" maxLength={SITE_HEADING_MAX} value={m.settings.heading} disabled={disabled} autoFocus
              placeholder="No heading" onChange={(e) => set({ heading: e.target.value })} />
            <span />
            <span className="note">Shows the top ten members, name and Total only, with a link to the full leaderboard. Visitors who are not signed in see only a note to sign in.</span>
          </>
        )}

        {m.type === "image" && (
          <>
            <label htmlFor={`${id}-url`}>Picture address</label>
            <input id={`${id}-url`} type="url" inputMode="url" maxLength={SITE_ADDRESS_MAX} value={m.settings.url} disabled={disabled} autoFocus
              placeholder="https://…" onChange={(e) => set({ url: e.target.value })} />
            <label htmlFor={`${id}-alt`}>Description</label>
            <input id={`${id}-alt`} type="text" maxLength={SITE_IMAGE_ALT_MAX} value={m.settings.alt} disabled={disabled}
              placeholder="What the picture shows, for anyone who cannot see it" onChange={(e) => set({ alt: e.target.value })} />
            <label htmlFor={`${id}-width`}>Width (percent of the cell)</label>
            <input id={`${id}-width`} type="number" min={SITE_IMAGE_WIDTH_MIN} max={100} step={1} value={widthTyped ?? m.settings.width} disabled={disabled}
              onChange={(e) => {
                const typed = e.target.value;
                setWidthTyped(typed);
                const n = Number(typed);
                // A whole number already in range counts at once; anything else waits until the box is left.
                if (typed.trim() !== "" && Number.isInteger(n) && n >= SITE_IMAGE_WIDTH_MIN && n <= 100) set({ width: n });
              }}
              onBlur={() => {
                if (widthTyped === null) return;
                set({ width: siteImageWidth(widthTyped.trim() === "" ? m.settings.width : widthTyped) });
                setWidthTyped(null);
              }} />
          </>
        )}

        {m.type === "button" && (
          <>
            <label htmlFor={`${id}-label`}>Words</label>
            <input id={`${id}-label`} type="text" maxLength={SITE_BUTTON_LABEL_MAX} value={m.settings.label} disabled={disabled} autoFocus
              onChange={(e) => set({ label: e.target.value })} />
            <label htmlFor={`${id}-href`}>Link</label>
            <input id={`${id}-href`} type="text" inputMode="url" maxLength={SITE_ADDRESS_MAX} value={m.settings.href} disabled={disabled}
              placeholder="/about or https://…" onChange={(e) => set({ href: e.target.value })} />
            <label htmlFor={`${id}-new-tab`}>Open in a new tab</label>
            <input id={`${id}-new-tab`} type="checkbox" checked={m.settings.newTab} disabled={disabled} onChange={(e) => set({ newTab: e.target.checked })} />
            <label htmlFor={`${id}-bg`}>Button colour</label>
            <input id={`${id}-bg`} type="color" value={m.settings.color} disabled={disabled} onChange={(e) => set({ color: e.target.value.toLowerCase() })} />
            <label htmlFor={`${id}-fg`}>Words colour</label>
            <input id={`${id}-fg`} type="color" value={m.settings.textColor} disabled={disabled} onChange={(e) => set({ textColor: e.target.value.toLowerCase() })} />
          </>
        )}
      </div>

      {m.type === "text" && (
        <CommentEditor label="Text" value={m.settings.body} maxLength={SITE_TEXT_MAX} autoFocus disabled={disabled}
          placeholder="Type the words. **bold**, *italic*, lines starting - for a list, [words](https://…) for a link."
          onChange={(body) => set({ body })} />
      )}

      {problem && <p className="error" role="alert">{problem} Fix it before you save.</p>}
    </aside>
  );
}
