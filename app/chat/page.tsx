import { redirect } from "next/navigation";
import { commHref, commMode } from "../comm/commMode";

/** `/chat` is now Comm (WC-234, Dane's "C"): old links and bookmarks forward to `/comm`, keeping the mode. */
export default async function OldChatPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const { mode } = await searchParams;
  redirect(commHref(commMode(mode)));
}
