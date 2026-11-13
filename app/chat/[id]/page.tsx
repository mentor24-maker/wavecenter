import ChatScreen from "../ChatScreen";

/** `/chat/<id>`: the member's chats with one open, so every chat has a link (ChatScreen.tsx). */
export default async function OpenChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatScreen openId={id} />;
}
