"use client";

/**
 * The Evolution scroller (Dane, 2026-10-30: "It's a thumbnail scroller."),
 * on Home since 2026-11-01: a row of cards, one per change merged into main
 * that altered a screen, oldest on the left and newest on the right, opened
 * scrolled to the newest.
 * Each card is labeled with Dane's own words that asked for the change and
 * one link to where he said them (Dane, 2026-10-31: "use my prompt only,
 * with a link to the thread"). A phone swipes the
 * row; a keyboard tabs through the cards or scrolls the focused row with the
 * arrow keys. A round arrow button at each end of the row steps it one card
 * back or forward, greyed out at that end (Dane, 2026-11-01: "obvious
 * advance and reverse arrow icons"). Clicking a card's picture opens it full size, where the
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
  const [ends, setEnds] = useState({ atStart: true, atEnd: true });

  // Which ends the row is scrolled to, so the arrow at that end greys out.
  function measure() {
    const el = strip.current;
    if (!el) return;
    setEnds({ atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }

  // Open on the newest change.
  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = el.scrollWidth;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // One card back or forward: a card's width plus the gap between cards.
  function slide(by: -1 | 1) {
    const el = strip.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: by * (card.offsetWidth + gap), behavior: "smooth" });
  }

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
        {cards.length} change{cards.length === 1 ? "" : "s"}, oldest on the left. Use the arrows, swipe or scroll sideways; click a picture to see it full size.
      </p>
      <div className="evolution-rail">
        <button type="button" className="evolution-arrow" onClick={() => slide(-1)} disabled={ends.atStart} aria-label="Older change">
          <ArrowIcon back />
        </button>
        <ol className="evolution" ref={strip} tabIndex={0} aria-label="Changes to WaveCenter, oldest first" onScroll={measure}>
          {cards.map((c, i) => (
            <li key={c.sha} className="evolution-card box level-1">
              {c.imageUrl ? (
                <button type="button" className="evolution-thumb" onClick={() => show(i)} aria-label={`Open the screenshot of “${short(c.words)}” full size`}>
                  {/* A signed link to a private picture: plain <img>, not next/image, which would fetch it through the web server. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.imageUrl} alt="" loading="lazy" />
                </button>
              ) : (
                <p className="evolution-text error">{cardNote(c)}</p>
              )}
              <CardFacts card={c} />
            </li>
          ))}
        </ol>
        <button type="button" className="evolution-arrow" onClick={() => slide(1)} disabled={ends.atEnd} aria-label="Newer change">
          <ArrowIcon />
        </button>
      </div>

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
              <img src={current.imageUrl} alt={`WaveCenter's ${current.page ?? ""} screen right after “${short(current.words)}”`} />
            ) : (
              <p className="error">{cardNote(current)}</p>
            )}
            <CardFacts card={current} full />
          </>
        )}
      </dialog>
    </>
  );
}

/** A bold chevron pointing left (back) or right. */
function ArrowIcon({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d={back ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

/** The first line of a card's words, for a picture's label. */
function short(words: string): string {
  const first = words.split("\n")[0].trim();
  return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}

/** Dane's words (or, with none on record, what changed), the merge date, and the one link to the thread. */
function CardFacts({ card, full = false }: { card: EvolutionCard; full?: boolean }) {
  const thread = card.threadUrl;
  return (
    <div className="evolution-facts">
      {card.fromDane ? (
        <blockquote className={full ? "evolution-words" : "evolution-words clamped"}>{card.words}</blockquote>
      ) : (
        <p className={full ? "evolution-words" : "evolution-words clamped"}>{card.words}</p>
      )}
      <p className="note">
        Merged {card.mergedAt}
        {card.page ? <> &middot; shows {card.page}</> : null}
      </p>
      {thread && (
        <p className="evolution-links">
          {thread.startsWith("/") ? (
            <Link href={thread}>See the thread</Link>
          ) : (
            <a href={thread} target="_blank" rel="noreferrer">See the thread</a>
          )}
        </p>
      )}
    </div>
  );
}
