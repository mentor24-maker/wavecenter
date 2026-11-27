import type { ReactNode } from "react";
import { CommDatesProvider } from "./CommDates";

/**
 * Comm's layout: it stays mounted while the member moves between `/comm`
 * and `/comm/<id>`, so the From/To dates and their toggle survive opening a
 * chat (WC-253, CommDates.tsx).
 */
export default function CommLayout({ children }: { children: ReactNode }) {
  return <CommDatesProvider>{children}</CommDatesProvider>;
}
