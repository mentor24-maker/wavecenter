import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { listChatMessages, listChats, type Chat, type ChatMessage } from "../../core/chat.ts";
import { mayOpenAdmin } from "../../core/members.ts";
import { AVATARS } from "../../core/profiles.ts";
import { chatTaskTitles, latestChatMessages, supabaseChatStore } from "../lib/chatStore";
import { headerPoints, type HeaderPoints } from "../lib/engagementStore";
import { headerName } from "../lib/memberProfileStore";
import { listMembers, myRole } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest, supabaseSettings } from "../lib/supabase";
import { shownName } from "../members/memberView";
import SiteHeader from "../SiteHeader";
import ChatWindow, { type OpenChat } from "./ChatWindow";
import { CHAT_ID, SOMEONE, chatList, chatPartner, chatTopic } from "./chatView";

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The chat window (Dane, 2026-11-12: "two WaveCenter users could chat with
 * each other in real-time in a dedicated window"), shared by `/chat` and
 * `/chat/<id>`. On the left, the member's chats, newest activity first; on
 * the right, the open chat's messages and the send box. Everything is read
 * through the member's own session, so row-level security keeps every chat
 * private to the members in it; this screen adds no access of its own.
 *
 * The page is the one source of what is shown. The window (ChatWindow.tsx)
 * listens live and reloads this page's data when a message arrives, so a
 * message shows once, in its place. Every empty or failed part says why
 * (rule 7). Signed-out visitors are sent to sign in.
 */
export default async function ChatScreen({ openId }: { openId: string | null }) {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && !user && !checkFailed) redirect("/sign-in");

  if (!supabase || !user) {
    return (
      <Shell>
        <p className="error" role="alert">
          {!supabase ? "This copy of WaveCenter has no chat settings (no database settings), so there are no chats to show." : SIGN_IN_CHECK_FAILED}
        </p>
      </Shell>
    );
  }

  const store = supabaseChatStore(supabase);
  const [name, role, points, chats, members] = await Promise.all([
    headerName(supabase, user),
    read(() => myRole(supabase, user.id)),
    headerPoints(supabase, user.id),
    read(() => listChats(store, user.id)),
    read(() => listMembers(supabase)),
  ]);
  const isAdmin = role.error === null && mayOpenAdmin(role.value);

  if (chats.error !== null) {
    return (
      <Shell name={name} isAdmin={isAdmin} points={points}>
        <p className="error" role="alert">Your chats could not be loaded: {chats.error}. Nothing has been lost; try reloading the page.</p>
      </Shell>
    );
  }

  // Names and avatars as each member's profile lets others see them. If the
  // member list cannot be read, chats still show, under a plain name.
  const people = new Map((members.value ?? []).map((m) => [m.memberId, m]));
  const who = (id: string | null) => {
    const m = id ? people.get(id) : undefined;
    return {
      name: m ? shownName(m) : SOMEONE,
      symbol: (m && AVATARS.find((a) => a.id === m.avatar)?.symbol) || "👤",
    };
  };

  // The titles of the tasks chats are about. If they cannot be read, a chat
  // still shows, labelled "a task", still linked.
  const [latest, titleRead] = await Promise.all([
    read(() => latestChatMessages(supabase, chats.value.map((c) => c.id))),
    read(() => chatTaskTitles(supabase, chats.value)),
  ]);
  const titles = titleRead.value ?? new Map<string, string>();
  const list = chatList(chats.value, latest.value ?? new Map<string, ChatMessage>(), user.id, who, titles);

  let open: OpenChat | null = null;
  let openProblem: string | null = null;
  if (openId) {
    const chat: Chat | undefined = CHAT_ID.test(openId) ? chats.value.find((c) => c.id === openId) : undefined;
    if (!chat) {
      openProblem = "This chat was not found. It may not exist, or you may not be in it.";
    } else {
      const messages = await read(() => listChatMessages(store, user.id, chat));
      const other = who(chatPartner(chat, user.id));
      open = {
        id: chat.id,
        topic: chatTopic(chat, titles),
        otherName: other.name,
        otherSymbol: other.symbol,
        messages: messages.value ?? [],
        error: messages.error,
      };
    }
  }

  return (
    <Shell name={name} isAdmin={isAdmin} points={points}>
      {members.error !== null && (
        <p className="note" role="status">Members&apos; names could not be loaded ({members.error}), so chats show &quot;{SOMEONE}&quot;. Try reloading the page.</p>
      )}
      {titleRead.error !== null && (
        <p className="note" role="status">The titles of the tasks your chats are about could not be loaded ({titleRead.error}), so they show as &quot;a task&quot;. Try reloading the page.</p>
      )}
      {latest.error !== null && (
        <p className="error" role="alert">The last message of each chat could not be loaded: {latest.error}. Nothing has been lost; try reloading the page.</p>
      )}
      <ChatWindow
        me={user.id}
        chats={list}
        open={open}
        openProblem={openProblem}
        openId={openId}
        live={liveSettings()}
      />
    </Shell>
  );
}

/**
 * What the window needs to listen live: the project address and the public
 * anon key, read per request, never baked in at build (rule 4). Never the
 * service key (rule 3).
 */
function liveSettings() {
  const settings = supabaseSettings();
  return "missing" in settings ? null : { url: settings.url, anonKey: settings.anonKey };
}

function Shell({ name, isAdmin, points, children }: { name?: string; isAdmin?: boolean; points?: HeaderPoints; children: ReactNode }) {
  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={points} />
      <main className="chat-page">
        <h1>Chat</h1>
        {children}
      </main>
    </>
  );
}
