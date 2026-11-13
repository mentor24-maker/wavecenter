/**
 * What the task page's "Chat about this task" panel (TaskChats.tsx) shows,
 * read on the server through the member's own session: their chats about
 * this task (row-level security hands back only chats they are in), the chat
 * in the link with its messages, and the members they may chat with, the
 * task's maker first. Each part that cannot be read carries its reason, so
 * the panel says why instead of looking empty (rule 7). Server only.
 */
import { chatsAboutTask, listChatMessages, listChats, type ChatMessage } from "../../../core/chat.ts";
import { AVATARS } from "../../../core/profiles.ts";
import type { Task } from "../../../core/tasks.ts";
import { latestChatMessages, supabaseChatStore } from "../../lib/chatStore";
import { listMembers } from "../../lib/memberRoleStore";
import type { supabaseForRequest } from "../../lib/supabase";
import { shownName } from "../../members/memberView";
import type { OpenChat } from "../../chat/ChatWindow";
import { CHAT_ID, SOMEONE, chatList, chatPartner, type ChatListItem } from "../../chat/chatView";
import type { ChatPartnerOption } from "./TaskChats";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export interface TaskChatPanel {
  partners: ChatPartnerOption[];
  partnersError: string | null;
  chats: ChatListItem[];
  chatsError: string | null;
  /** Why the last message of each chat could not be read, or null: the list still shows. */
  latestError: string | null;
  open: OpenChat | null;
  openProblem: string | null;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function taskChatPanel(supabase: Client, me: string, task: Pick<Task, "id" | "ownerId" | "title">, openChatId: string | null): Promise<TaskChatPanel> {
  const store = supabaseChatStore(supabase);
  const [membersRead, chatsRead] = await Promise.all([
    listMembers(supabase).then((value) => ({ value, error: null }), (err) => ({ value: null, error: reason(err) })),
    listChats(store, me).then((value) => ({ value, error: null }), (err) => ({ value: null, error: reason(err) })),
  ]);

  const people = new Map((membersRead.value ?? []).map((m) => [m.memberId, m]));
  const who = (id: string | null) => {
    const m = id ? people.get(id) : undefined;
    return { name: m ? shownName(m) : SOMEONE, symbol: (m && AVATARS.find((a) => a.id === m.avatar)?.symbol) || "👤" };
  };

  // Anyone but the member themself (Dane, 2026-11-12: "Any two members, for
  // now"), the task's maker first, then by name.
  const partners: ChatPartnerOption[] = (membersRead.value ?? [])
    .filter((m) => m.memberId !== me)
    .map((m) => ({ id: m.memberId, name: shownName(m), isMaker: m.memberId === task.ownerId }))
    .sort((a, b) => (a.isMaker !== b.isMaker ? (a.isMaker ? -1 : 1) : a.name.localeCompare(b.name)));

  if (chatsRead.error !== null) {
    return { partners, partnersError: membersRead.error, chats: [], chatsError: chatsRead.error, latestError: null, open: null, openProblem: null };
  }

  const mine = chatsAboutTask(chatsRead.value, task.id);
  let latest = new Map<string, ChatMessage>();
  // When only the last messages cannot be read, the chats still list (as on
  // /chat) with a note saying so, rather than hiding chats that did load.
  let latestError: string | null = null;
  try {
    latest = await latestChatMessages(supabase, mine.map((c) => c.id));
  } catch (err) {
    latestError = reason(err);
  }
  const chats = chatList(mine, latest, me, who);

  let open: OpenChat | null = null;
  let openProblem: string | null = null;
  if (openChatId) {
    const chat = CHAT_ID.test(openChatId) ? mine.find((c) => c.id === openChatId) : undefined;
    if (!chat) {
      openProblem = "That chat was not found among your chats about this task. It may not exist, or you may not be in it.";
    } else {
      const other = who(chatPartner(chat, me));
      let messages: ChatMessage[] = [];
      let error: string | null = null;
      try {
        messages = await listChatMessages(store, me, chat);
      } catch (err) {
        error = reason(err);
      }
      open = { id: chat.id, topic: { kind: "task", taskId: task.id, title: task.title }, otherName: other.name, otherSymbol: other.symbol, messages, error };
    }
  }

  return { partners, partnersError: membersRead.error, chats, chatsError: null, latestError, open, openProblem };
}
