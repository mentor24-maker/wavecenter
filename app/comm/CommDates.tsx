"use client";

/**
 * The Sync window's From and To days and what they narrow (WC-253), kept
 * for the whole visit to Comm.
 *
 * `/comm` and `/comm/<id>` are separate pages, so opening a chat mounts a
 * fresh chat window and anything it holds starts over: a chat list narrowed
 * by dates un-narrowed on the first click (WC-253 review). Comm's layout
 * (app/comm/layout.tsx) is not remounted when the chat in the address
 * changes, so the choice lives here, in the browser, until the member
 * leaves Comm or reloads. It is never written to the address or saved
 * between visits (the ticket's non-goals).
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { ANY_DATE, type DateRange, type DatesApplyTo } from "./chatView";

export interface CommDates {
  range: DateRange;
  setRange: (update: (r: DateRange) => DateRange) => void;
  applyTo: DatesApplyTo;
  setApplyTo: (value: DatesApplyTo) => void;
}

const Dates = createContext<CommDates | null>(null);

export function CommDatesProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<DateRange>(ANY_DATE);
  const [applyTo, setApplyTo] = useState<DatesApplyTo>("messages");
  return <Dates.Provider value={{ range, setRange, applyTo, setApplyTo }}>{children}</Dates.Provider>;
}

/**
 * The dates the chat window shows and changes: Comm's, when it is inside
 * Comm's layout, else its own (they then last only as long as the window).
 */
export function useCommDates(): CommDates {
  const shared = useContext(Dates);
  const [range, setRange] = useState<DateRange>(ANY_DATE);
  const [applyTo, setApplyTo] = useState<DatesApplyTo>("messages");
  return shared ?? { range, setRange, applyTo, setApplyTo };
}
