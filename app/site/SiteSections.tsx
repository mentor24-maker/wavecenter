/**
 * Draws a page's sections and their modules as a visitor sees them (WC-210):
 * each section a grid of its layout's cells, with its alignment, spacing and
 * background (core's siteSectionStyle), and each module drawn live by
 * SiteModuleView. One renderer, for the public page and the editor's
 * phone, tablet and desktop preview (WC-211): a section's per-screen settings
 * go out as class names, and the CSS's container queries on `.site-page`
 * hide or stack it at the page's own width. Nothing is ever drawn as HTML.
 */
import { siteSectionCells, siteSectionClasses, siteSectionStyle, type SiteSection } from "../../core/website.ts";
import SiteModuleView from "../admin/website/SiteModuleView";

export default function SiteSections({ sections }: { sections: readonly SiteSection[] }) {
  return (
    <div className="site-page">
      {sections.map((s) => (
        <section key={s.id} className={["site-section", ...siteSectionClasses(s)].join(" ")} style={siteSectionStyle(s)} aria-label={s.title || undefined}>
          {siteSectionCells(s.layout).map((cell) => (
            <div key={cell} className="site-cell">
              {s.modules.filter((m) => m.cell === cell).map((m) => (
                <SiteModuleView key={m.id} module={m} live />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
