import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_BODY_MAX, chatMessageProblem, isInChat, listChatMessages, listChats, sendChatMessage, startChat, startChatProblem } from './chat.ts';
import { MemoryChatStore } from './memoryChatStore.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';

const TOOL = 'wavecenter';
const MIGRATION = readFileSync(new URL('../supabase/migrations/20261112120000_chats.sql', import.meta.url), 'utf8');

function scoredSetup() {
  const ledger = new MemoryEngagementStore();
  const chats = new MemoryChatStore(ledger);
  return { ledger, chats };
}

/** Sign in as `who` and start their chat with `other`. */
async function chatAs(store: MemoryChatStore, who: string, other: string, taskId: string | null = null) {
  store.signedIn = who;
  return (await startChat(store, { memberId: who, otherMemberId: other, taskId })).id;
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
  assert.deepEqual(store.chatRows[1], { id: aboutTask, taskId: 'task-1', memberIds: ['kim', 'dane'], createdBy: 'kim', createdAt: store.chatRows[1].createdAt });
});

test('a chat with yourself, an unknown member or a task you may not read is refused, and nothing is saved', async () => {
  const store = new MemoryChatStore();
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberId: 'dane' }), /cannot start a chat with yourself/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberId: 'nobody' }), /no such member/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberId: '' }), /no such member/);
  await assert.rejects(startChat(store, { memberId: 'dane', otherMemberId: 'kim', taskId: 'task-gone' }), /no task of that id you may read/);
  await assert.rejects(startChat(store, { memberId: '', otherMemberId: 'kim' }), /signed out/);
  assert.equal(store.chatRows.length, 0);
  assert.equal(startChatProblem('dane', 'kim'), null);
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
  assert.equal(ledger.rows.length, 0, 'a refused message scores nothing');
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
  assert.deepEqual(ledger.rows.map(({ memberId, kind, points, tool, taskId }) => ({ memberId, kind, points, tool, taskId })), [
    { memberId: 'dane', kind: 'sent_a_chat_message', points, tool: TOOL, taskId: null },
    { memberId: 'kim', kind: 'sent_a_chat_message', points, tool: 'another-tool', taskId: null },
  ]);
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
  const blank = { ...store, start: store.start.bind(store), send: async () => ({ id: '' }), chats: store.chats.bind(store), messages: store.messages.bind(store) };
  await assert.rejects(sendChatMessage(blank, { senderId: 'dane', chatId: chat, body: 'Hi' }, TOOL), /did not save/);
  await assert.rejects(startChat({ ...blank, start: async () => ({ id: '' }) }, { memberId: 'dane', otherMemberId: 'kim' }), /did not start/);
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
