import { redirect } from "next/navigation";
import { commHref } from "../../comm/commMode";

/** `/chat/<id>` is now `/comm/<id>` (WC-234, Dane's "C"): an old link to a chat still opens it. */
export default async function OldChatLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(commHref("sync", id));
}
