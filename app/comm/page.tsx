import CommScreen from "./CommScreen";
import { commMode } from "./commMode";

/** `/comm`: Comm in Sync mode with no chat open, or Async with `?mode=async` (CommScreen.tsx). */
export default async function CommPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const { mode } = await searchParams;
  return <CommScreen mode={commMode(mode)} openId={null} />;
}
