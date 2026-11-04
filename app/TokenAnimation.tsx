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
 */
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { tokenSizeFor, type TokenSize } from "../core/tokens.ts";
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

    function onPlay(e: Event) {
      const play = (e as CustomEvent<TokenPlay>).detail;
      const el = target.current;
      if (!play || !el || !Number.isFinite(play.points)) return;
      stop();
      setDisc(null);
      // Count from the real total, so playing twice in a row never stacks a preview on a preview.
      const base = real;
      if (base !== null) show(base);
      const to = base === null ? null : base + play.points;
      const settle = () => {
        if (play.preview && base !== null) later(() => show(base), HOLD_MS);
      };
      const arrive = () => {
        setDisc(null);
        if (to === null) return;
        if (reducedMotion()) {
          show(to);
          settle();
        } else countTo(to, settle);
      };

      // Scrolled down the page, the total is out of sight: jump up to it first, and rise from below it.
      const seen = el.getBoundingClientRect();
      const hidden = seen.bottom < 0 || seen.top > window.innerHeight;
      if (hidden) window.scrollTo({ top: 0, behavior: "instant" });
      const size = tokenSizeFor(play.points, play.sizes);
      if (!size || reducedMotion()) return arrive();
      const fly = (from: TokenPlay["from"]) => {
        const box = el.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        setDisc({
          key: performance.now(),
          style: {
            left: x - size.diameter / 2,
            top: y - size.diameter / 2,
            width: size.diameter,
            height: size.diameter,
            "--token-color": size.color,
            "--token-from-x": `${from ? from.x - x : 0}px`,
            "--token-from-y": `${from ? from.y - y : RISE_PX}px`,
          } as CSSProperties,
        });
        later(arrive, FLY_MS);
      };
      fly(hidden ? undefined : play.from);
    }

    window.addEventListener(EVENT, onPlay);
    return () => {
      window.removeEventListener(EVENT, onPlay);
      stop();
    };
  }, [real]);

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
