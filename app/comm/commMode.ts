/**
 * Comm's two modes (WC-234; Dane: "one main comm panel ... with a toggle that
 * switches between synchronous (sync) and asynchronous (async) modes").
 * Sync is live chat; Async is messages, like email. The mode is in the
 * address (`?mode=async`), so a reload or a shared link lands in the same
 * mode; anything else is Sync, the default.
 */
export type CommMode = "sync" | "async";

export const COMM_MODES: readonly { mode: CommMode; label: string; help: string }[] = [
  { mode: "sync", label: "Sync", help: "Sync is live chat: talk in real time with a member who is here now." },
  { mode: "async", label: "Async", help: "Async is messages, like email: write now, and they answer when they can." },
];

/** The mode a page's `mode` search parameter asks for. */
export function commMode(param: string | string[] | undefined): CommMode {
  const value = Array.isArray(param) ? param[0] : param;
  return value === "async" ? "async" : "sync";
}

/** The address of Comm in `mode`; `chatId` opens one chat (Sync only). */
export function commHref(mode: CommMode, chatId: string | null = null): string {
  if (mode === "async") return "/comm?mode=async";
  return chatId ? `/comm/${encodeURIComponent(chatId)}` : "/comm";
}
