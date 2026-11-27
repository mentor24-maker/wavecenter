import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_BODY_MAX, CHAT_MEMBERS_MAX, addChatMember, addChatMemberProblem, chatMessageProblem, chatOthers, isGroupChat, chatSubject, chatsAboutTask, countUnread, isInChat, isUnreadChatMessage, listChatMessages, listChats, markChatRead, sendChatMessage, startChat, startChatProblem, unreadBadge, unreadChats } from './chat.ts';
import { MemoryChatStore } from './memoryChatStore.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';

const TOOL = 'wavecenter';
const MIGRATION = readFileSync(new URL('../supabase/migrations/20261112120000_chats.sql', import.meta.url), 'utf8');
const GROUP_MIGRATION = readFileSync(new URL('../supabase/migrations/20261128130000_group_chats.sql', import.meta.url), 'utf8');
const ADD_MIGRATION = readFileSync(new URL('../supabase/migrations/20261128150000_add_chat_member.sql', import.meta.url), 'utf8');
const UNREAD_MIGRATION = readFileSync(new URL('../supabase/migrations/20261113150000_chat_unread.sql', import.meta.url), 'utf8');

function scoredSetup() {
  const ledger = new MemoryEngagementStore();
  const chats = new MemoryChatStore(ledger);
  return { ledger, chats };
}

/** Sign in as `who` and start their chat with `other`. */
async function chatAs(store: MemoryChatStore, who: string, other: string, taskId: string | null = null) {
  store.signedIn = who;
  return (await startChat(store, { memberId: who, otherMemberIds: other, taskId }, TOOL)).id;
}

test('starting a chat twice, from either side, finds the same chat; a task makes it a different one', async () => {
  const store = new MemoryChatStore();
  const first = await chatAs(store, 'dane', 'kim');
  assert.equal(await chatAs(store, 'dane', 'kim'), first, 'the same member again');
  assert.equal(await chatAs(store, 'kim', 'dane'), first, 'the other member, the other way round');
  const aboutTask = await chatAs(store, 'kim', 'dane', 'task-1');
  assert.notEqual(aboutTask, first, 'a chat about a task is its own chat');
  assert.equal(await chatAs(store, 'dane', 'kim', 'task-1'), aboutTask);
  assert.notEqual(await chatAs(store, 'dane', 'lee'), first, 'another pair is another chat');
  assert.equal(store.chatRows.length, 3);
  assert.deepEqual(store.chatRows[1], { id: aboutTask, taskId: 'task-1', aboutATask: true, memberIds: ['kim', 'dane'], createdBy: 'kim', createdAt: store.chatRows[1].createdAt });
});

test('a chat with yourself, an unknown member or a task you may not read is refused, and nothing is saved', async () => {
  const store = new MemoryChatStore();
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: 'dane' }, TOOL), /cannot start a chat with yourself/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: 'nobody' }, TOOL), /no such member/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: '' }, TOOL), /no such member/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: 'kim', taskId: 'task-gone' }, TOOL), /no task of that id you may read/);
  await assert.rejects(startChat(store, { memberId: '', otherMemberIds: 'kim' }, TOOL), /signed out/);
  assert.equal(store.chatRows.length, 0);
  assert.equal(startChatProblem('dane', 'kim'), null);
});

test('a group chat: several members start one chat, and the same set again, from any of them, finds it (WC-252)', async () => {
  const { ledger, chats: store } = scoredSetup();
  store.signedIn = 'dane';
  const group = (await startChat(store, { memberId: 'dane', otherMemberIds: ['kim', 'lee'] }, TOOL)).id;
  assert.deepEqual(store.chatRows[0].memberIds, ['dane', 'kim', 'lee']);
  assert.equal(isGroupChat(store.chatRows[0]), true);
  store.signedIn = 'lee';
  assert.equal((await startChat(store, { memberId: 'lee', otherMemberIds: ['dane', 'kim'] }, TOOL)).id, group, 'another member, the set in another order');
  store.signedIn = 'kim';
  assert.equal((await startChat(store, { memberId: 'kim', otherMemberIds: ['lee', 'dane'] }, TOOL)).id, group);
  const pair = await chatAs(store, 'kim', 'dane');
  assert.notEqual(pair, group, 'two of the group is a different chat');
  assert.equal(isGroupChat(store.chatRows[1]), false);
  const aboutTask = (await startChat(store, { memberId: 'kim', otherMemberIds: ['lee', 'dane'], taskId: 'task-1' }, TOOL)).id;
  assert.notEqual(aboutTask, group, 'the same group about a task is its own chat');
  assert.equal(store.chatRows.length, 3);
  const started = ledger.rows.filter((r) => r.kind === 'started_a_chat');
  assert.deepEqual(started.map((r) => r.memberId), ['dane', 'kim', 'kim'], 'only a new chat scores, for whoever started it');
  // Everyone in the group reads it and writes in it; each one's unread counts the others' messages.
  for (const who of ['dane', 'kim', 'lee']) {
    store.signedIn = who;
    await sendChatMessage(store, { senderId: who, chatId: group, body: `hello from ${who}` }, TOOL);
  }
  for (const who of ['dane', 'kim', 'lee']) {
    store.signedIn = who;
    assert.deepEqual(await store.unread(), [{ chatId: group, unread: 2 }], `${who} has the other two's messages unread, never their own`);
  }
});

test('a group is refused, with nothing saved, with nobody else, yourself, someone twice, or more than the limit', async () => {
  const store = new MemoryChatStore();
  for (let i = 0; i < 20; i += 1) store.members.add(`m${i}`);
  const others = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);
  assert.equal(CHAT_MEMBERS_MAX, 10);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: [] }, TOOL), /at least one other member/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: ['kim', 'dane'] }, TOOL), /cannot start a chat with yourself/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: ['kim', 'lee', 'kim'] }, TOOL), /picked twice/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: others(CHAT_MEMBERS_MAX) }, TOOL), /at most 10 members, you included/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberIds: ['kim', 'nobody'] }, TOOL), /no such member/);
  assert.equal(store.chatRows.length, 0);
  const full = await startChat(store, { memberId: 'dane', otherMemberIds: others(CHAT_MEMBERS_MAX - 1) }, TOOL);
  assert.equal(store.chatRows.find((c) => c.id === full.id)?.memberIds.length, CHAT_MEMBERS_MAX, 'exactly the limit is allowed');
});

test('startChatProblem names each refusal in plain words, in the database\'s order', () => {
  assert.equal(startChatProblem('dane', ['kim', 'lee']), null);
  assert.equal(startChatProblem('dane', 'kim'), null, 'a single member still works');
  assert.match(startChatProblem('', ['kim']) ?? '', /signed out/);
  assert.match(startChatProblem('dane', []) ?? '', /at least one other member/);
  assert.match(startChatProblem('dane', ['', 'kim']) ?? '', /no such member/);
  assert.match(startChatProblem('dane', ['dane']) ?? '', /yourself/);
  assert.match(startChatProblem('dane', ['kim', 'kim']) ?? '', /twice/);
  assert.match(startChatProblem('dane', Array.from({ length: 10 }, (_, i) => `x${i}`)) ?? '', /at most 10/);
  assert.deepEqual(chatOthers('kim'), ['kim']);
  assert.deepEqual(chatOthers(['kim', 'lee']), ['kim', 'lee']);
  assert.equal(isGroupChat({ memberIds: ['a', 'b'] }), false);
});

test('the database repeats the group rules in the same words, finds a chat by its whole set, and keeps the two-person call', () => {
  const code = GROUP_MIGRATION.replace(/--.*$/gm, '');
  assert.match(code, /function public\.start_chat\(other_members uuid\[\], about_task uuid default null\)/);
  assert.match(code, /function public\.start_chat\(other_member uuid, about_task uuid default null\)[\s\S]*return public\.start_chat\(array\[other_member\], about_task\)/);
  for (const words of ['Pick at least one other member to chat with.', 'A chat can have at most 10 members, you included, so no chat was started.', 'There is no such member.', 'You cannot start a chat with yourself.', 'The same member was picked twice, so no chat was started.']) {
    assert.ok(code.includes(words), `the database says "${words}"`);
  }
  assert.match(code, /cardinality\(others\) \+ 1 > 10/, 'the limit is CHAT_MEMBERS_MAX');
  assert.match(code, /pg_advisory_xact_lock/, 'a lock on the whole set');
  assert.match(code, /grant execute on function public\.start_chat\(uuid\[\], uuid\) to authenticated;/);
  assert.match(code, /revoke execute on function public\.start_chat\(uuid\[\], uuid\) from public, anon;/);
  assert.doesNotMatch(code, /create table|grant (insert|update|delete)/i, 'no new table and no direct writes');
});

test('a member in the chat sends a message: it is saved trimmed, with its tool', async () => {
  const store = new MemoryChatStore();
  const chat = await chatAs(store, 'dane', 'kim');
  const sent = await sendChatMessage(store, { senderId: 'dane', chatId: chat, body: '  Hello Kim \n' }, ` ${TOOL} `);
  assert.deepEqual(store.messageRows, [{ id: sent.id, chatId: chat, senderId: 'dane', body: 'Hello Kim', tool: TOOL, sentAt: store.messageRows[0].sentAt }]);
});

test('an empty or over-long message, a missing tool, or a sender not in the chat is refused, and nothing is saved', async () => {
  const { ledger, chats: store } = scoredSetup();
  const chat = await chatAs(store, 'dane', 'kim');
  await assert.rejects(sendChatMessage(store, { senderId: 'dane', chatId: chat, body: ' \n\t ' }, TOOL), /needs some text/);
  await assert.rejects(sendChatMessage(store, { senderId: 'dane', chatId: chat, body: 'x'.repeat(CHAT_BODY_MAX + 1) }, TOOL), /too long: keep it to 4000/);
  await assert.rejects(sendChatMessage(store, { senderId: 'dane', chatId: chat, body: 'Hi' }, ' '), /must name the tool/);
  store.signedIn = 'lee';
  await assert.rejects(sendChatMessage(store, { senderId: 'lee', chatId: chat, body: 'Let me in' }, TOOL), /not in that chat/);
  await assert.rejects(sendChatMessage(store, { senderId: 'lee', chatId: 'chat-nope', body: 'Hi' }, TOOL), /not in that chat/);
  assert.equal(store.messageRows.length, 0);
  assert.deepEqual(ledger.rows.map((e) => e.kind), ['started_a_chat'], 'a refused message scores nothing; only starting the chat did');
  // Exactly the limit is fine; the limit counts the trimmed text.
  assert.equal(chatMessageProblem(` ${'x'.repeat(CHAT_BODY_MAX)} `), null);
});

test('each chat message saved records one engagement for its sender, naming its tool; a refused one records none', async () => {
  const { ledger, chats: store } = scoredSetup();
  const chat = await chatAs(store, 'dane', 'kim');
  await sendChatMessage(store, { senderId: 'dane', chatId: chat, body: 'Hi' }, TOOL);
  store.signedIn = 'kim';
  await sendChatMessage(store, { senderId: 'kim', chatId: chat, body: 'Hello back' }, 'another-tool');
  await assert.rejects(sendChatMessage(store, { senderId: 'kim', chatId: chat, body: '' }, TOOL));
  const points = (await ledger.rules()).find((r) => r.kind === 'sent_a_chat_message')!.points;
  assert.equal(points, 4);
  assert.deepEqual(ledger.rows.filter((e) => e.kind === 'sent_a_chat_message').map(({ memberId, kind, points, tool, taskId }) => ({ memberId, kind, points, tool, taskId })), [
    { memberId: 'dane', kind: 'sent_a_chat_message', points, tool: TOOL, taskId: null },
    { memberId: 'kim', kind: 'sent_a_chat_message', points, tool: 'another-tool', taskId: null },
  ]);
});

test('starting a new chat records one engagement for the member who started it; opening one already there records none', async () => {
  const { ledger, chats: store } = scoredSetup();
  const first = await chatAs(store, 'dane', 'kim');
  assert.equal(await chatAs(store, 'dane', 'kim'), first, 'the same member opens it again');
  assert.equal(await chatAs(store, 'kim', 'dane'), first, 'the other member opens it');
  store.signedIn = 'kim';
  await startChat(store, { memberId: 'kim', otherMemberIds: 'dane', taskId: 'task-1' }, 'another-tool');
  // Refused: nothing is made, so nothing is recorded.
  await assert.rejects(chatAs(store, 'lee', 'lee'), /yourself/);
  await assert.rejects(chatAs(store, 'lee', 'nobody'), /no such member/);
  await assert.rejects(startChat(store, { memberId: 'lee', otherMemberIds: 'kim' }, '  '), /must name the tool/);
  const points = (await ledger.rules()).find((r) => r.kind === 'started_a_chat')!.points;
  assert.equal(points, 1);
  assert.deepEqual(ledger.rows.map(({ memberId, kind, points, tool, taskId }) => ({ memberId, kind, points, tool, taskId })), [
    { memberId: 'dane', kind: 'started_a_chat', points, tool: TOOL, taskId: null },
    { memberId: 'kim', kind: 'started_a_chat', points, tool: 'another-tool', taskId: null },
  ]);
  assert.equal(store.chatRows.length, 2);
});

test('if the engagement for a new chat cannot be written, the chat is not made either', async () => {
  const { ledger, chats: store } = scoredSetup();
  ledger.failInsert = true;
  await assert.rejects(chatAs(store, 'dane', 'kim'));
  assert.equal(store.chatRows.length, 0);
  assert.equal(ledger.rows.length, 0);
});

test('the database scores a new chat for the signed-in member who started it, and skips a service-key insert', () => {
  const code = readFileSync(new URL('../supabase/migrations/20261123130000_score_started_a_chat.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  assert.match(code, /v_member uuid := auth\.uid\(\);/);
  assert.match(code, /if v_member is not null and new\.created_by is not distinct from v_member then\s+perform public\.record_engagement\(v_member, 'started_a_chat', public\.engagement_tool\('supabase-api'\), null\);/);
  assert.match(code, /create trigger chats_score\s+after insert on public\.chats\s+for each row execute function public\.chats_score\(\);/);
  assert.match(code, /revoke execute on function public\.chats_score\(\) from public, anon, authenticated;/);
  assert.match(code, /security definer\s+set search_path = ''/);
});

test('if the engagement cannot be written, the chat message is not saved either', async () => {
  const { ledger, chats: store } = scoredSetup();
  const chat = await chatAs(store, 'dane', 'kim');
  ledger.failInsert = true;
  await assert.rejects(sendChatMessage(store, { senderId: 'dane', chatId: chat, body: 'Hi' }, TOOL));
  assert.equal(store.messageRows.length, 0);
});

test('a failed save says so; it is never reported as sent', async () => {
  const store = new MemoryChatStore();
  const chat = await chatAs(store, 'dane', 'kim');
  store.failNextSend = true;
  await assert.rejects(sendChatMessage(store, { senderId: 'dane', chatId: chat, body: 'Hi' }, TOOL), /refused to save/);
  const blank = { ...store, start: store.start.bind(store), send: async () => ({ id: '' }), chats: store.chats.bind(store), messages: store.messages.bind(store), addMember: store.addMember.bind(store) };
  await assert.rejects(sendChatMessage(blank, { senderId: 'dane', chatId: chat, body: 'Hi' }, TOOL), /did not save/);
  await assert.rejects(startChat({ ...blank, start: async () => ({ id: '' }) }, { memberId: 'dane', otherMemberIds: 'kim' }, TOOL), /did not start/);
});

test('a member outside a chat reads nothing from it, even from a store that reads too much', async () => {
  const store = new MemoryChatStore();
  const chat = await chatAs(store, 'dane', 'kim');
  await sendChatMessage(store, { senderId: 'dane', chatId: chat, body: 'Private' }, TOOL);
  const [danesChat] = await listChats(store, 'dane');

  store.signedIn = 'lee';
  assert.deepEqual(await store.chats('lee'), [], 'the store reads none of it, as row-level security does');
  assert.deepEqual(await store.messages(chat), []);
  store.leaky = true;
  assert.deepEqual(await listChats(store, 'lee'), [], 'core drops a chat the member is not in');
  assert.deepEqual(await listChatMessages(store, 'lee', danesChat), [], 'and every message of it');
  assert.equal(isInChat(danesChat, 'lee'), false);
});

test('a member reads their own chats newest first, and a chat\'s messages oldest first', async () => {
  const store = new MemoryChatStore();
  const withKim = await chatAs(store, 'dane', 'kim');
  const withLee = await chatAs(store, 'dane', 'lee');
  await sendChatMessage(store, { senderId: 'dane', chatId: withKim, body: 'One' }, TOOL);
  store.signedIn = 'kim';
  await sendChatMessage(store, { senderId: 'kim', chatId: withKim, body: 'Two' }, TOOL);
  store.signedIn = 'dane';
  await sendChatMessage(store, { senderId: 'dane', chatId: withLee, body: 'To Lee' }, TOOL);
  store.leaky = true;
  const chats = await listChats(store, 'dane');
  assert.deepEqual(chats.map((c) => c.id), [withLee, withKim]);
  const kimChat = chats.find((c) => c.id === withKim)!;
  assert.deepEqual((await listChatMessages(store, 'dane', kimChat)).map((m) => [m.senderId, m.body]), [['dane', 'One'], ['kim', 'Two']], 'messages from another chat are dropped');
  await assert.rejects(listChats(store, ''), /signed out/);
});

test('the database repeats core\'s rules, keeps the tables private and read-only, and makes the window live', () => {
  const code = MIGRATION.replace(/--.*$/gm, '');
  for (const table of ['chats', 'chat_members', 'chat_messages']) {
    assert.match(code, new RegExp(`create table if not exists public\\.${table} \\(`), table);
    assert.match(code, new RegExp(`alter table public\\.${table} enable row level security;`), `${table}: row-level security on when it is made`);
    assert.match(code, new RegExp(`create policy "${table}: members of the chat can read" on public\\.${table}\\s+for select to authenticated\\s+using \\(private\\.in_chat\\(`), `${table}: read only by its members`);
  }
  assert.doesNotMatch(code, /create policy[^;]*for (insert|update|delete|all)/i, 'nobody writes the tables directly');
  assert.doesNotMatch(code, /grant (insert|update|delete|all)[^;]* on public\.chat/i, 'nobody is granted a write');
  assert.match(code, new RegExp(`between 1 and ${CHAT_BODY_MAX}`), 'the same length limit as core');
  assert.match(code, new RegExp(`length\\(clean\\) > ${CHAT_BODY_MAX}`));
  for (const words of ['cannot start a chat with yourself', 'There is no such member.', 'no task of that id you may read', 'not in that chat', 'needs some text', 'must name the tool']) {
    assert.ok(code.includes(words), `the database says "${words}" too`);
  }
  assert.match(code, /perform public\.record_engagement\(new\.sender_id, 'sent_a_chat_message', new\.tool, null\)/);
  assert.match(code, /alter publication supabase_realtime add table public\.chat_messages/);
  assert.match(code, /security definer\s+set search_path = ''/);
});

/** `who` says `body` in `chatId`. */
async function say(store: MemoryChatStore, who: string, chatId: string, body: string) {
  store.signedIn = who;
  await sendChatMessage(store, { senderId: who, chatId, body }, TOOL);
}

test('a message is unread when it is newer than your last read and not your own', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 13, 0, 0, s)).toISOString();
  assert.equal(isUnreadChatMessage({ senderId: 'kim', sentAt: at(5) }, null, 'dane'), true, 'never read: everything from others counts');
  assert.equal(isUnreadChatMessage({ senderId: 'kim', sentAt: at(5) }, at(4), 'dane'), true, 'newer than the last read');
  assert.equal(isUnreadChatMessage({ senderId: 'kim', sentAt: at(5) }, at(5), 'dane'), false, 'read at the same moment');
  assert.equal(isUnreadChatMessage({ senderId: 'kim', sentAt: at(3) }, at(4), 'dane'), false, 'older than the last read');
  assert.equal(isUnreadChatMessage({ senderId: 'dane', sentAt: at(5) }, null, 'dane'), false, 'your own message never counts');
  assert.equal(isUnreadChatMessage({ senderId: 'kim', sentAt: at(5) }, null, ''), false, 'signed out: nothing counts');
  assert.equal(countUnread([{ senderId: 'kim', sentAt: at(1) }, { senderId: 'dane', sentAt: at(2) }, { senderId: 'kim', sentAt: at(3) }], at(2), 'dane'), 1);
});

test('the unread badge is hidden at 0 and says 9+ above 9', () => {
  assert.equal(unreadBadge(0), null);
  assert.equal(unreadBadge(-1), null);
  assert.equal(unreadBadge(Number.NaN), null);
  assert.equal(unreadBadge(1), '1');
  assert.equal(unreadBadge(9), '9');
  assert.equal(unreadBadge(10), '9+');
  assert.equal(unreadBadge(250), '9+');
});

test('a message to you counts as unread until you open the chat; your own never do', async () => {
  const store = new MemoryChatStore();
  const chat = await chatAs(store, 'kim', 'dane');
  await say(store, 'kim', chat, 'ping');
  await say(store, 'kim', chat, 'are you there?');
  store.signedIn = 'dane';
  assert.deepEqual([...(await unreadChats(store, 'dane'))], [[chat, 2]], 'two from Kim, never read');
  store.signedIn = 'kim';
  assert.deepEqual([...(await unreadChats(store, 'kim'))], [], 'Kim\'s own messages are not unread for her');

  store.signedIn = 'dane';
  await markChatRead(store, { memberId: 'dane', chatId: chat });
  assert.deepEqual([...(await unreadChats(store, 'dane'))], [], 'opening it clears it');
  await say(store, 'dane', chat, 'here');
  store.signedIn = 'dane';
  assert.deepEqual([...(await unreadChats(store, 'dane'))], [], 'replying adds nothing unread for yourself');
  await say(store, 'kim', chat, 'great');
  store.signedIn = 'dane';
  assert.deepEqual([...(await unreadChats(store, 'dane'))], [[chat, 1]], 'a newer message counts again');
});

test('only you can mark your chats read: it marks yours alone, and a member outside the chat is refused', async () => {
  const store = new MemoryChatStore();
  const chat = await chatAs(store, 'kim', 'dane');
  await say(store, 'kim', chat, 'ping');
  await say(store, 'dane', chat, 'pong');

  store.signedIn = 'dane';
  await markChatRead(store, { memberId: 'dane', chatId: chat });
  assert.deepEqual([...store.lastRead.keys()], [`${chat} dane`], 'only Dane\'s own read is recorded');
  store.signedIn = 'kim';
  assert.deepEqual([...(await unreadChats(store, 'kim'))], [[chat, 1]], 'Dane opening it does not clear it for Kim');

  store.signedIn = 'lee';
  await assert.rejects(markChatRead(store, { memberId: 'lee', chatId: chat }), /not in that chat/);
  await assert.rejects(markChatRead(store, { memberId: 'lee', chatId: 'chat-nope' }), /not in that chat/);
  await assert.rejects(markChatRead(store, { memberId: '', chatId: chat }), /signed out/);
  await assert.rejects(markChatRead(store, { memberId: 'lee', chatId: '' }), /not in that chat/);
  assert.equal(store.lastRead.size, 1, 'nothing saved for a refused mark');
});

test('a failed unread read throws instead of showing nothing unread, and odd rows are dropped', async () => {
  const failing = { markRead: async () => ({ readAt: '' }), unread: async () => { throw new Error('The database refused to read your unread chats.'); } };
  await assert.rejects(unreadChats(failing, 'dane'), /refused/);
  await assert.rejects(markChatRead(failing, { memberId: 'dane', chatId: 'chat-1' }), /not marked read/);
  await assert.rejects(unreadChats(failing, ''), /signed out/);
  const odd = { markRead: async () => ({ readAt: 'x' }), unread: async () => [{ chatId: 'a', unread: 3 }, { chatId: 'b', unread: 0 }, { chatId: '', unread: 2 }] };
  assert.deepEqual([...(await unreadChats(odd, 'dane'))], [['a', 3]]);
});

test('the database marks a chat read for the caller only, refuses outsiders, and counts by core\'s rule', () => {
  const mark = UNREAD_MIGRATION.slice(UNREAD_MIGRATION.indexOf('function public.mark_chat_read'), UNREAD_MIGRATION.indexOf('function public.my_chat_unread'));
  assert.match(UNREAD_MIGRATION, /add column if not exists last_read_at timestamptz;/);
  assert.match(mark, /security definer/);
  assert.match(mark, /not private\.in_chat\(chat, caller\)/);
  assert.match(mark, /where cm\.chat_id = chat and cm\.member_id = caller;/, 'only the caller\'s own row');
  assert.doesNotMatch(UNREAD_MIGRATION, /record_engagement/, 'marking read is not scored');
  assert.doesNotMatch(UNREAD_MIGRATION, /grant (update|insert|delete)/i, 'still no direct writes');
  const count = UNREAD_MIGRATION.slice(UNREAD_MIGRATION.indexOf('function public.my_chat_unread'));
  assert.match(count, /security invoker/, 'row-level security still applies to the count');
  assert.match(count, /msg\.sender_id <> cm\.member_id/, 'your own messages never count');
  assert.match(count, /cm\.last_read_at is null or msg\.created_at > cm\.last_read_at/);
});

test('a chat about a task stays one after the task is deleted, and a plain chat between the same two is a separate chat', async () => {
  const store = new MemoryChatStore();
  const aboutTask = await chatAs(store, 'dane', 'kim', 'task-1');
  store.deleteTask('task-1');
  const gone = store.chatRows.find((c) => c.id === aboutTask)!;
  assert.deepEqual(chatSubject(gone), { kind: 'deleted-task' });
  const plain = await chatAs(store, 'kim', 'dane');
  assert.notEqual(plain, aboutTask, 'a plain chat is never the old task chat');
  assert.deepEqual(chatSubject(store.chatRows.find((c) => c.id === plain)!), { kind: 'none' });
});

test('what a chat is about, and the chats about one task', () => {
  assert.deepEqual(chatSubject({ taskId: 'task-1', aboutATask: true }), { kind: 'task', taskId: 'task-1' });
  assert.deepEqual(chatSubject({ taskId: null, aboutATask: true }), { kind: 'deleted-task' });
  assert.deepEqual(chatSubject({ taskId: null, aboutATask: false }), { kind: 'none' });
  const chats = [{ id: 'a', taskId: 'task-1' }, { id: 'b', taskId: null }, { id: 'c', taskId: 'task-2' }, { id: 'd', taskId: 'task-1' }];
  assert.deepEqual(chatsAboutTask(chats, 'task-1').map((c) => c.id), ['a', 'd']);
  assert.deepEqual(chatsAboutTask(chats, ''), []);
});

// WC-256: a member of a chat brings one more person into it.
test('a member of a two-person chat adds a third: it becomes a group, and they read every earlier message', async () => {
  const store = new MemoryChatStore();
  const id = await chatAs(store, 'dane', 'kim');
  await sendChatMessage(store, { senderId: 'dane', chatId: id, body: 'before lee' }, TOOL);
  const chat = (await listChats(store, 'dane')).find((c) => c.id === id)!;
  assert.deepEqual(await addChatMember(store, { memberId: 'dane', chat, newMemberId: 'lee' }), { id });
  store.signedIn = 'lee';
  const lees = await listChats(store, 'lee');
  assert.deepEqual(lees.map((c) => c.id), [id], 'the chat is in their list');
  assert.equal(isGroupChat(lees[0]), true);
  assert.deepEqual((await listChatMessages(store, 'lee', lees[0])).map((m) => m.body), ['before lee']);
  assert.deepEqual(await store.unread(), [{ chatId: id, unread: 1 }], 'never read: the earlier message counts for them');
  await sendChatMessage(store, { senderId: 'lee', chatId: id, body: 'hi' }, TOOL);
  store.signedIn = 'dane';
  assert.deepEqual(await store.unread(), [{ chatId: id, unread: 1 }], 'their message counts for the others');
});

test('a chat about a task may grow too, and adding someone scores nothing', async () => {
  const { ledger, chats } = scoredSetup();
  const id = await chatAs(chats, 'dane', 'kim', 'task-1');
  const before = ledger.rows.length;
  const chat = (await listChats(chats, 'dane')).find((c) => c.id === id)!;
  await addChatMember(chats, { memberId: 'dane', chat, newMemberId: 'lee' });
  assert.equal(ledger.rows.length, before, 'not a scored action');
  assert.deepEqual(chats.chatRows.find((c) => c.id === id)!.memberIds.sort(), ['dane', 'kim', 'lee']);
});

test('adding someone already in, an unknown member, past the limit, or from outside the chat is refused, and nothing changes', async () => {
  const store = new MemoryChatStore();
  const id = await chatAs(store, 'dane', 'kim');
  const chat = (await listChats(store, 'dane')).find((c) => c.id === id)!;
  const members = () => JSON.stringify(store.chatRows.find((c) => c.id === id)!.memberIds);
  const start = members();
  await assert.rejects(addChatMember(store, { memberId: 'dane', chat, newMemberId: 'kim' }), /already in this chat/);
  await assert.rejects(addChatMember(store, { memberId: 'dane', chat, newMemberId: 'dane' }), /already in this chat/);
  await assert.rejects(addChatMember(store, { memberId: 'dane', chat, newMemberId: 'nobody' }), /no such member/);
  await assert.rejects(addChatMember(store, { memberId: 'dane', chat, newMemberId: '' }), /no such member/);
  // Lee is not in it: core refuses, and so does the store even when core is skipped.
  await assert.rejects(addChatMember(store, { memberId: 'lee', chat, newMemberId: 'lee' }), /not in that chat/);
  store.signedIn = 'lee';
  await assert.rejects(store.addMember(id, 'lee'), /not in that chat/);
  await assert.rejects(store.addMember('chat-none', 'lee'), /not in that chat/);
  store.signedIn = 'dane';
  const full = { ...chat, memberIds: Array.from({ length: CHAT_MEMBERS_MAX }, (_, i) => (i === 0 ? 'dane' : `m${i}`)) };
  await assert.rejects(addChatMember(store, { memberId: 'dane', chat: full, newMemberId: 'lee' }), /at most 10 members/);
  assert.equal(members(), start);
});

test('the store refuses a chat that is already full, even when core is skipped', async () => {
  const store = new MemoryChatStore();
  for (let i = 1; i < CHAT_MEMBERS_MAX; i += 1) store.members.add(`m${i}`);
  store.members.add('one-too-many');
  const id = await chatAs(store, 'dane', 'kim');
  for (let i = 1; store.chatRows[0].memberIds.length < CHAT_MEMBERS_MAX; i += 1) await store.addMember(id, `m${i}`);
  await assert.rejects(store.addMember(id, 'one-too-many'), /at most 10 members/);
  assert.equal(store.chatRows[0].memberIds.length, CHAT_MEMBERS_MAX);
});

test('a failed add says so; it is never reported as done', async () => {
  const store = new MemoryChatStore();
  const id = await chatAs(store, 'dane', 'kim');
  const chat = (await listChats(store, 'dane')).find((c) => c.id === id)!;
  store.failNextAdd = true;
  await assert.rejects(addChatMember(store, { memberId: 'dane', chat, newMemberId: 'lee' }), /refused/);
  assert.equal(store.chatRows[0].memberIds.includes('lee'), false);
  const unconfirmed = { start: store.start.bind(store), send: store.send.bind(store), chats: store.chats.bind(store), messages: store.messages.bind(store), addMember: async () => ({ id: '' }) };
  await assert.rejects(addChatMember(unconfirmed, { memberId: 'dane', chat, newMemberId: 'lee' }), /did not confirm/);
});

test('addChatMemberProblem names each refusal in plain words, in the database\'s order', () => {
  const chat = { memberIds: ['dane', 'kim'] };
  assert.match(addChatMemberProblem(chat, '', 'lee') ?? '', /signed out/);
  assert.match(addChatMemberProblem(chat, 'lee', 'lee') ?? '', /not in that chat/);
  assert.match(addChatMemberProblem(chat, 'dane', '') ?? '', /no such member/);
  assert.match(addChatMemberProblem(chat, 'dane', 'kim') ?? '', /already in this chat/);
  assert.equal(addChatMemberProblem(chat, 'dane', 'lee'), null, 'two may grow into three');
  const nine = { memberIds: ['dane', ...Array.from({ length: CHAT_MEMBERS_MAX - 2 }, (_, i) => `m${i}`)] };
  assert.equal(addChatMemberProblem(nine, 'dane', 'lee'), null, 'the tenth fits');
  assert.match(addChatMemberProblem({ memberIds: [...nine.memberIds, 'x'] }, 'dane', 'lee') ?? '', /at most 10 members/);
});

test('the database repeats the add rules in the same words and order, one add at a time, with no direct writes', () => {
  const code = ADD_MIGRATION.replace(/--.*$/gm, '');
  assert.match(code, /function public\.add_chat_member\(chat uuid, new_member uuid\)/);
  assert.match(code, /security definer/);
  const order = ['You are signed out, so nobody was added.', 'You are not in that chat, so nobody was added.', 'There is no such member, so nobody was added.', 'That member is already in this chat, so nobody was added.', 'A chat can have at most 10 members, so nobody was added.'];
  const at = order.map((words) => code.indexOf(words));
  assert.ok(at.every((i) => i > 0), 'every refusal is there');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in core\'s order');
  assert.match(code, /members_now \+ 1 > 10/, 'the limit is CHAT_MEMBERS_MAX');
  assert.match(code, /pg_advisory_xact_lock/);
  assert.match(code, /revoke execute on function public\.add_chat_member\(uuid, uuid\) from public, anon;/);
  assert.match(code, /grant execute on function public\.add_chat_member\(uuid, uuid\) to authenticated;/);
  assert.doesNotMatch(code, /create table|grant (insert|update|delete)|record_engagement/i, 'no new table, no direct writes, not scored');
});
