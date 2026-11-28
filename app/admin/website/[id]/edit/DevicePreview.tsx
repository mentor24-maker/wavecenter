"use client";

/**
 * The page as a phone, a tablet or a desktop shows it (WC-211), drawn from
 * the editor's unsaved sections by the public renderer (SiteSections), so
 * what is previewed is what a visitor gets. Ported in spirit from
 * StarCaster's components/builder/builder-device-preview.tsx.
 *
 * StarCaster needed an iframe because its phone rules were window-width
 * media queries, which a narrow box in a wide window never matches. Here the
 * rules are container queries on the page itself (app/globals.css,
 * `.site-page`), so a box at the device's real width IS that device to them.
 * The frame is the device's own width. When the editor is narrower, the box keeps its real width
 * and only its picture is shrunk to fit (StarCaster's previewFrameScale), so
 * a desktop still gets the desktop rules on a small laptop.
 *
 * A button on the preview does not go anywhere: a click must never leave
 * unsaved work. A screen with nothing on it says why (rule 7).
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { SITE_DEVICES, sitePageHasContent, sitePageHasContentOn, type SiteDevice, type SiteSection } from "../../../../../core/website.ts";
import type { LeaderboardTop } from "../../../../../core/leaderboard.ts";
import type { RecentlyCompleted } from "../../../../../core/recentlyCompleted.ts";
import SiteSections from "../../../../site/SiteSections";

/** Shrink to fit, never enlarge. */
function fit(width: number, available: number): number {
  const scale = Math.min(1, available / width);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function emptyWords(sections: readonly SiteSection[], device: SiteDevice, label: string): string | null {
  if (sitePageHasContentOn(sections, device)) return null;
  if (sections.length === 0) return "This page has no sections yet, so there is nothing to preview. Add a section below.";
  if (sitePageHasContent(sections)) return `Every section with something in it is hidden on a ${label.toLowerCase()}, so a ${label.toLowerCase()} shows an empty page.`;
  return "Nothing on this page shows to a visitor yet: add a heading, text, a picture, a button, a leaderboard or the recently completed tasks below.";
}

export default function DevicePreview({ sections, device, leaderboard, completed }: {
  sections: readonly SiteSection[];
  device: SiteDevice;
  /** The leaderboard read on the server, for a Leaderboard module (WC-237). */
  leaderboard?: LeaderboardTop;
  /** The recently completed tasks read on the server, for that module (WC-265). */
  completed?: RecentlyCompleted;
}) {
  const spec = SITE_DEVICES.find((d) => d.key === device) ?? SITE_DEVICES[0];
  const stage = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number>(spec.width);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const s = stage.current;
    const p = screen.current;
    if (!s || !p || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setAvailable(s.clientWidth);
      setHeight(p.offsetHeight);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(s);
    watch.observe(p);
    return () => watch.disconnect();
  }, []);

  const scale = fit(spec.width, available);
  const empty = emptyWords(sections, device, spec.label);

  /** A link on the preview never leaves the editor. */
  function stay(e: MouseEvent) {
    if ((e.target as HTMLElement).closest("a")) e.preventDefault();
  }

  return (
    <section className="device-preview" aria-label={`Preview on a ${spec.label.toLowerCase()}`}>
      <p className="note" role="status">
        {spec.label}, {spec.width} pixels wide{scale < 1 ? `, shrunk to ${Math.round(scale * 100)}% to fit` : ""}. Unsaved changes show here; buttons do not go anywhere in the preview.
      </p>
      {empty && <p className="note" role="status">{empty}</p>}
      {/* +2: the stage's own 1-pixel border, so the screen inside it is the device's full width. */}
      <div ref={stage} className="device-preview-stage" style={{ maxWidth: spec.width + 2, height: height ? Math.ceil(height * scale) : undefined }}>
        <div ref={screen} className="device-preview-screen" data-device={device} onClickCapture={stay}
          style={{ width: spec.width, transform: scale < 1 ? `scale(${scale})` : undefined }}>
          <SiteSections sections={sections} leaderboard={leaderboard} completed={completed} />
        </div>
      </div>
    </section>
  );
}
