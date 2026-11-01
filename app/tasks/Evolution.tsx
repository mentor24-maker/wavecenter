"use client";

/**
 * The Evolution scroller (Dane, 2026-10-30: "It's a thumbnail scroller."),
 * on Home since 2026-11-01: a
 * row of cards, one per change merged into main, oldest on the left and
 * newest on the right, opened scrolled to the newest. A phone swipes the
 * row; a keyboard tabs through the cards or scrolls the focused row with the
 * arrow keys. Clicking a card's picture opens it full size, where the
 * buttons or the left and right arrow keys step through the changes in merge
 * order. Only reads; nothing here writes.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { arrowStep, cardNote, step, type EvolutionCard } from "./evolutionView";

export default function Evolution({ cards }: { cards: EvolutionCard[] }) {
  const strip = useRef<HTMLOListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);

  // Open on the newest change.
  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  function show(index: number) {
    setOpen(index);
    if (!dialog.current?.open) dialog.current?.showModal();
  }

  function move(by: -1 | 1) {
    setOpen((at) => (at === null ? null : step(at, by, cards.length) ?? at));
  }

  // While the full-size view is open, the arrow keys step it whatever has
  // focus (a disabled end button sends focus to the page body).
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: globalThis.KeyboardEvent) {
      const by = arrowStep(e.key);
      if (by === null) return;
      e.preventDefault();
      setOpen((at) => (at === null ? null : step(at, by, cards.length) ?? at));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, cards.length]);

  // When the full-size view closes, put the row where the last change shown sits.
  function onClose() {
    if (open !== null) strip.current?.children[open]?.scrollIntoView({ block: "nearest", inline: "center" });
    setOpen(null);
  }

  const current = open === null ? null : cards[open];

  return (
    <>
      <p className="note">
        {cards.length} change{cards.length === 1 ? "" : "s"}, oldest on the left. Swipe or scroll sideways; click a picture to see it full size.
      </p>
      <ol className="evolution" ref={strip} tabIndex={0} aria-label="Changes to WaveCenter, oldest first">
        {cards.map((c, i) => (
          <li key={c.sha} className="evolution-card box level-1">
            {c.imageUrl ? (
              <button type="button" className="evolution-thumb" onClick={() => show(i)} aria-label={`Open the screenshot of “${c.title}” full size`}>
                {/* A signed link to a private picture: plain <img>, not next/image, which would fetch it through the web server. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrl} alt="" loading="lazy" />
              </button>
            ) : (
              <p className={c.state === "failed" || c.state === "captured" ? "evolution-text error" : "evolution-text note"}>{cardNote(c)}</p>
            )}
            <CardFacts card={c} />
          </li>
        ))}
      </ol>

      <dialog ref={dialog} className="evolution-full" aria-label="Screenshot, full size" onClose={onClose}>
        {current && open !== null && (
          <>
            <div className="evolution-full-bar">
              <button type="button" onClick={() => move(-1)} disabled={open === 0}>&larr; Previous</button>
              <span className="note">{open + 1} of {cards.length}</span>
              <button type="button" onClick={() => move(1)} disabled={open === cards.length - 1}>Next &rarr;</button>
              <button type="button" className="link" onClick={() => dialog.current?.close()}>Close</button>
            </div>
            {current.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.imageUrl} alt={`WaveCenter's ${current.page ?? ""} screen right after “${current.title}”`} />
            ) : (
              <p className={current.state === "no screen" ? "note" : "error"}>{cardNote(current)}</p>
            )}
            <CardFacts card={current} />
          </>
        )}
      </dialog>
    </>
  );
}

/** The title, the merge date, and the links to the PR, the ticket and the task. */
function CardFacts({ card }: { card: EvolutionCard }) {
  return (
    <div className="evolution-facts">
      <h3>{card.title}</h3>
      <p className="note">
        Merged {card.mergedAt}
        {card.page && card.state === "captured" ? <> &middot; shows {card.page}</> : null}
      </p>
      <p className="evolution-links">
        {card.prUrl && <a href={card.prUrl} target="_blank" rel="noreferrer">PR #{card.prNumber}</a>}
        {card.ticketUrl && <a href={card.ticketUrl} target="_blank" rel="noreferrer">ClickUp ticket</a>}
        {card.taskId && <Link href={`/tasks/${card.taskId}`}>WaveCenter task</Link>}
      </p>
    </div>
  );
}
