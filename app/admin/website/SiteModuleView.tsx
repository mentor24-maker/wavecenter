/**
 * Draws one module of a page (WC-209): a heading, a block of text, a picture
 * or a button. Nothing is ever drawn as HTML: a heading's words go into a
 * text node, which React escapes; text is WaveCenter's rich text, drawn by
 * the same component as a comment (app/tasks/RichText.tsx); a picture's
 * address and a button's link have already been checked by core
 * (core/website.ts: https: pictures; http:, https: or WaveCenter links).
 *
 * In the editor (`live` false) a button is drawn but does not go anywhere, so
 * a click never leaves unsaved work. A module with nothing in it yet says so
 * there (rule 7); on a live page it draws nothing.
 */
import { siteButtonHref, siteImageUrl, type SiteModule } from "../../../core/website.ts";
import RichText from "../../tasks/RichText";

export default function SiteModuleView({ module: m, live = false }: { module: SiteModule; live?: boolean }) {
  const empty = (words: string) => (live ? null : <p className="note">{words}</p>);
  switch (m.type) {
    case "heading": {
      if (!m.settings.text) return empty("Empty heading: type its words in the panel.");
      const Tag = m.settings.level;
      return <Tag className="site-heading" style={{ color: m.settings.color || undefined }}>{m.settings.text}</Tag>;
    }
    case "text":
      return m.settings.body ? <RichText body={m.settings.body} className="site-text" /> : empty("Empty text: type its words in the panel.");
    case "image": {
      const url = siteImageUrl(m.settings.url);
      if (!url) return empty(m.settings.url ? "This picture's address cannot be used: it must start with https://." : "No picture yet: give its address in the panel.");
      // A picture from anywhere on the web: plain <img>, not next/image, which would fetch it through the web server.
      // eslint-disable-next-line @next/next/no-img-element
      return <img className="site-image" src={url} alt={m.settings.alt} style={{ width: `${m.settings.width}%` }} loading="lazy" />;
    }
    case "button": {
      const style = { background: m.settings.color, color: m.settings.textColor, borderColor: m.settings.color };
      const label = m.settings.label || "Button";
      const href = siteButtonHref(m.settings.href);
      if (live && href) {
        return (
          <a className="site-button" style={style} href={href} {...(m.settings.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {label}
          </a>
        );
      }
      if (live) return <span className="site-button" style={style}>{label}</span>;
      return (
        <span>
          <span className="site-button" style={style}>{label}</span>
          <span className="note"> {href ? `→ ${href}` : m.settings.href ? "This link cannot be used." : "No link yet."}</span>
        </span>
      );
    }
  }
}
