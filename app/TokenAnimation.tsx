"use client";

/**
 * The earned-points token (Dane, 2026-11-03: "a small colored disk will rotate
 * as it floats up to their point total and then changes the amount in that
 * total"). It draws the header's point total, and when told to play, a disc
 * in the size and colour core/tokens.ts `tokenSizeFor` picks for the amount
 * spins as it floats up to the total; when it arrives the total counts up to
 * its new value. The disc is fixed to the screen, ignores clicks, and is gone
 * once it lands, so it never covers the menu. When the total is scrolled out
 * of sight, the page jumps up to it first.
 *
 * Anything plays it with `playToken` (a browser event, so the caller needs no
 * hold on the header). A preview counts up, holds a moment, then settles back
 * to the real total: it changes nobody's points. With the browser's
 * reduce-motion setting on there is no disc; the number just changes.
 *
 * A total that could not be loaded says so ("points unavailable"), never 0;
 * a disc still lands on it, but there is no number to change.
 *
 * When a page loads, it also plays the tokens for points earned since this
 * browser last showed them (Dane chose "the next time a page loads", not
 * live): core/tokens.ts `tokensToPlay` picks them, the total starts that much
 * lower and steps up with each, oldest first, ending on the real figure. The
 * browser's local storage remembers the newest earning shown, per member; a
 * first visit plays nothing. If the earnings could not be read (`catchUp` is
 * null) nothing plays and the plain total shows.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { tokenSizeFor, tokensToPlay, type SeenMark, type TokenSize } from "../core/tokens.ts";
import type { HeaderPoints } from "./lib/engagementStore";

const EVENT = "wavecenter:token";
/** How long the disc takes to float up, the count up, and a preview's hold before it settles back. Keep FLY_MS in step with globals.css `token-fly`. */
const FLY_MS = 1100;
const COUNT_MS = 600;
const HOLD_MS = 1500;
/** Where the disc starts when the caller names no starting point: this far below the total. */
const RISE_PX = 160;

type Size = Pick<TokenSize, "diameter" | "color" | "minPoints">;

export interface TokenPlay {
  /** The points earned: they choose the disc's size, and are added to the total. */
  points: number;
  /** The token sizes to choose from (Game → Manage → Tokens). */
  sizes: readonly Size[];
  /** Where on screen the disc starts (for example the button that played it); below the total if left out. */
  from?: { x: number; y: number };
  /** A preview settles back to the real total afterwards. */
  preview?: boolean;
}

/** Play the token in the header. Does nothing where there is no header total (signed out). */
export function playToken(play: TokenPlay) {
  window.dispatchEvent(new CustomEvent<TokenPlay>(EVENT, { detail: play }));
}

type Disc = { key: number; style: CSSProperties };

/** Where this browser remembers the newest earning it has shown a member. */
const seenKey = (memberId: string) => `wavecenter:token-seen:${memberId}`;

function readSeen(memberId: string): SeenMark | null {
  try {
    const mark = JSON.parse(window.localStorage.getItem(seenKey(memberId)) ?? "null");
    return mark && typeof mark.id === "string" && typeof mark.createdAt === "string" ? { id: mark.id, createdAt: mark.createdAt } : null;
  } catch {
    return null;
  }
}

/** Remember the newest earning shown. False when the browser will not store it. */
function writeSeen(memberId: string, mark: SeenMark): boolean {
  try {
    window.localStorage.setItem(seenKey(memberId), JSON.stringify(mark));
    return true;
  } catch {
    return false;
  }
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function label(n: number) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "point" : "points"}`;
}

export default function TokenAnimation({ points }: { points: HeaderPoints }) {
  const real = points.error === null ? points.value : null;
  const [shown, setShown] = useState(real);
  const [disc, setDisc] = useState<Disc | null>(null);
  const [landed, setLanded] = useState(false);
  const target = useRef<HTMLAnchorElement>(null);
  const shownRef = useRef(real);
  const timers = useRef<number[]>([]);
  const frame = useRef(0);
  const catchUp = useRef(points.catchUp);
  catchUp.current = points.catchUp;
  // Plays again only when there is a newer earning to look at (a page change, a save).
  const newest = points.catchUp?.recent[0]?.id ?? null;

  // A new real total from the server (a page change, a save) is the truth.
  useEffect(() => {
    shownRef.current = real;
    setShown(real);
  }, [real]);

  useEffect(() => {
    function show(n: number | null) {
      shownRef.current = n;
      setShown(n);
    }
    function later(fn: () => void, ms: number) {
      timers.current.push(window.setTimeout(fn, ms));
    }
    function stop() {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      cancelAnimationFrame(frame.current);
    }

    function countTo(to: number, then: () => void) {
      const from = shownRef.current ?? to;
      const start = performance.now();
      setLanded(true);
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / COUNT_MS);
        show(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
        if (t < 1) frame.current = requestAnimationFrame(step);
        else {
          setLanded(false);
          then();
        }
      };
      frame.current = requestAnimationFrame(step);
    }

    /** One token: the disc floats up to the total, then the total counts up to `to` (when there is a number), then `then`. */
    function token(points: number, sizes: readonly Size[], from: TokenPlay["from"], to: number | null, then: () => void) {
      const el = target.current;
      if (!el) return;
      const arrive = () => {
        setDisc(null);
        if (to === null) return;
        if (reducedMotion()) {
          show(to);
          then();
        } else countTo(to, then);
      };

      // Scrolled down the page, the total is out of sight: jump up to it first, and rise from below it.
      const seen = el.getBoundingClientRect();
      const hidden = seen.bottom < 0 || seen.top > window.innerHeight;
      if (hidden) window.scrollTo({ top: 0, behavior: "instant" });
      const size = tokenSizeFor(points, sizes);
      if (!size || reducedMotion()) return arrive();
      const box = el.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const start = hidden ? undefined : from;
      setDisc({
        key: performance.now(),
        style: {
          left: x - size.diameter / 2,
          top: y - size.diameter / 2,
          width: size.diameter,
          height: size.diameter,
          "--token-color": size.color,
          "--token-from-x": `${start ? start.x - x : 0}px`,
          "--token-from-y": `${start ? start.y - y : RISE_PX}px`,
        } as CSSProperties,
      });
      later(arrive, FLY_MS);
    }

    function onPlay(e: Event) {
      const play = (e as CustomEvent<TokenPlay>).detail;
      if (!play || !target.current || !Number.isFinite(play.points)) return;
      stop();
      setDisc(null);
      // Count from the real total, so playing twice in a row never stacks a preview on a preview.
      const base = real;
      if (base !== null) show(base);
      const to = base === null ? null : base + play.points;
      token(play.points, play.sizes, play.from, to, () => {
        if (play.preview && base !== null) later(() => show(base), HOLD_MS);
      });
    }

    // What was earned since this browser last showed the total: play it now, oldest first.
    function playSinceLastVisit() {
      const c = catchUp.current;
      if (real === null || !c) return;
      const { plays, newest } = tokensToPlay(c.recent, readSeen(c.memberId));
      // Remembered a moment later, so React's double start in development does not use the mark up before playing.
      later(() => {
        // A browser that will not remember would replay the same tokens on every page, so it plays none.
        if (!newest || !writeSeen(c.memberId, newest) || !plays.length || reducedMotion()) return;
        show(real - plays.reduce((sum, p) => sum + p, 0));
        const next = (i: number) => {
          if (i < plays.length) token(plays[i], c.sizes, undefined, (shownRef.current ?? real) + plays[i], () => next(i + 1));
        };
        next(0);
      }, 0);
    }

    window.addEventListener(EVENT, onPlay);
    playSinceLastVisit();
    return () => {
      window.removeEventListener(EVENT, onPlay);
      stop();
    };
  }, [real, newest]);

  return (
    <>
      {shown !== null ? (
        <Link ref={target} href="/game" className={landed ? "quiet points counting" : "quiet points"} title="Your points: open My Points">
          {label(shown)}
        </Link>
      ) : (
        <Link ref={target} href="/game" className="quiet points unavailable" title={`Your points total could not be loaded: ${points.error}`}>
          points unavailable
        </Link>
      )}
      {disc && <span key={disc.key} className="token-disc" style={disc.style} aria-hidden="true" />}
    </>
  );
}
