"use client";

/**
 * A pod's Explore link on My Points: it opens a pop-up covering nearly the
 * whole screen with that section's full table. The table is drawn on the
 * server and handed in as children, so nothing is read in the browser. It
 * only reads. Close, Escape and a click on the backdrop shut it.
 */
import { useRef, type MouseEvent, type ReactNode } from "react";

export default function ExploreDialog({ title, children }: { title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  // A click on the backdrop lands on the dialog itself, outside its box.
  function onClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialog.current) dialog.current?.close();
  }

  return (
    <>
      <button type="button" className="link pod-explore" onClick={() => dialog.current?.showModal()}>
        Explore<span className="sr-only"> {title}</span>
      </button>
      <dialog ref={dialog} className="explore-dialog" aria-label={title} onClick={onClick}>
        {/* The dialog has no padding of its own, so only the backdrop is "outside". */}
        <div className="explore-inner">
          <div className="explore-bar">
            <h2>{title}</h2>
            <button type="button" onClick={() => dialog.current?.close()}>Close</button>
          </div>
          <div className="explore-body">{children}</div>
        </div>
      </dialog>
    </>
  );
}
