import CommScreen from "../CommScreen";
import { commMode } from "../commMode";

/** `/comm/<id>`: Comm's Sync mode with one chat open, so every chat has a link (CommScreen.tsx). */
export default async function CommChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string | string[] }> }) {
  const [{ id }, { mode }] = await Promise.all([params, searchParams]);
  return <CommScreen mode={commMode(mode)} openId={id} />;
}
