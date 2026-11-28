/**
 * Draws one module of a page (WC-209): a heading, a block of text, a picture,
 * a button or a leaderboard (WC-237). Nothing is ever drawn as HTML: a
 * heading's words go into a text node, which React escapes; text is
 * WaveCenter's rich text, drawn by
 * the same component as a comment (app/tasks/RichText.tsx); a picture's
 * address and a button's link have already been checked by core
 * (core/website.ts: https: pictures; http:, https: or WaveCenter links).
 *
 * In the editor (`live` false) a button is drawn but does not go anywhere, so
 * a click never leaves unsaved work. A module with nothing in it yet says so
 * there (rule 7); on a live page it draws nothing.
 *
 * A leaderboard draws the rows the page read on the server (`leaderboard`,
 * app/lib/engagementStore.ts readLeaderboardTop): the top ten, name and
 * Total only. A visitor who is not signed in sees only a note to sign in, no
 * names and no scores. A failed read and an empty board each say so.
 *
 * A Recently completed tasks module (WC-265) draws the tasks the page read on
 * the server (`completed`, app/lib/taskReads.ts readRecentlyCompletedModule):
 * the same five as Home's box, each linking to its task with "done <date>".
 * A visitor who is not signed in sees only a note to sign in, no titles.
 */
import type { LeaderboardTop } from "../../../core/leaderboard.ts";
import { completedDay, type RecentlyCompleted } from "../../../core/recentlyCompleted.ts";
import { siteButtonHref, siteImageUrl, siteModuleDrawsLive, type SiteModule } from "../../../core/website.ts";
import RichText from "../../tasks/RichText";

/** Where the full leaderboard is. */
const FULL_LEADERBOARD = "/game/leaderboard";

export default function SiteModuleView({ module: m, live = false, leaderboard, completed }: {
  module: SiteModule;
  live?: boolean;
  /** The leaderboard read on the server, for a Leaderboard module; missing reads as not loaded. */
  leaderboard?: LeaderboardTop;
  /** The recently completed tasks read on the server, for that module; missing reads as not loaded. */
  completed?: RecentlyCompleted;
}) {
  if (live && !siteModuleDrawsLive(m)) return null;
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
    case "leaderboard":
      return <LeaderboardModule heading={m.settings.heading} top={leaderboard} live={live} />;
    case "completed_tasks":
      return <CompletedTasksModule heading={m.settings.heading} completed={completed} live={live} />;
  }
}

/**
 * The most recently completed tasks (WC-265), drawn as Home's box draws them:
 * each title a link to its task, with "done <date>" beside it in Mountain
 * time. In the editor (`live` false) the links are plain words, so a click
 * never leaves unsaved work.
 */
function CompletedTasksModule({ heading, completed, live }: { heading: string; completed: RecentlyCompleted | undefined; live: boolean }) {
  const link = (href: string, words: string) => (live ? <a href={href}>{words}</a> : <span className="site-leaderboard-link">{words}</span>);
  let body;
  if (!completed) {
    body = <p className="error" role="alert">The recently completed tasks could not be loaded just now. Try reloading in a minute.</p>;
  } else if (completed.kind === "signed-out") {
    body = <p className="note">{link("/sign-in", "Sign in")} to see the recently completed tasks.</p>;
  } else if (completed.kind === "failed") {
    body = <p className="error" role="alert">{completed.problem}</p>;
  } else if (completed.rows.length === 0) {
    body = <p className="note" role="status">No task has been completed yet.</p>;
  } else {
    body = (
      <ul className="plain site-completed-tasks-rows">
        {completed.rows.map((t) => {
          const day = completedDay(t.completedAt);
          return (
            <li key={t.id}>
              {link(`/tasks/${t.id}`, t.title || "(untitled task)")}
              {day && <span className="note"> done {day}</span>}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="site-completed-tasks">
      {heading && <h3 className="site-heading">{heading}</h3>}
      {body}
    </div>
  );
}

/**
 * The top of the Game leaderboard (WC-237): rank, name and Total, then a link
 * to the full board. In the editor (`live` false) the links are drawn as
 * plain words, so a click never leaves unsaved work.
 */
function LeaderboardModule({ heading, top, live }: { heading: string; top: LeaderboardTop | undefined; live: boolean }) {
  const link = (href: string, words: string) => (live ? <a href={href}>{words}</a> : <span className="site-leaderboard-link">{words}</span>);
  let body;
  if (!top) {
    body = <p className="error" role="alert">The leaderboard could not be loaded just now. Try reloading in a minute.</p>;
  } else if (top.kind === "signed-out") {
    body = <p className="note">{link("/sign-in", "Sign in")} to see the leaderboard.</p>;
  } else if (top.kind === "failed") {
    body = <p className="error" role="alert">{top.problem}</p>;
  } else if (top.rows.length === 0) {
    body = <p className="note" role="status">There is nobody on the leaderboard yet: WaveCenter has no members to rank.</p>;
  } else {
    body = (
      <ol className="site-leaderboard-rows">
        {top.rows.map((row, i) => (
          <li key={i}>
            <span className="site-leaderboard-rank">{row.rank}</span>
            <span className="site-leaderboard-name">{row.named ? row.name : <i>{row.name}</i>}</span>
            <b className="site-leaderboard-total">{row.total.toLocaleString("en-US")}</b>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="site-leaderboard">
      {heading && <h3 className="site-heading">{heading}</h3>}
      {body}
      {top?.kind !== "signed-out" && <p className="site-leaderboard-more">{link(FULL_LEADERBOARD, "See the full leaderboard")}</p>}
    </div>
  );
}
