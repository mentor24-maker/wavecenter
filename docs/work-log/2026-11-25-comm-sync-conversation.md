## 2026-11-25 — Add conversation section to Comm > Sync mode (#207)

Comm's Sync mode (live chat) used to need a trip to the Members page before
you could talk to anyone. Now a "Chat with" picker sits on top of the chat
area: pick a member and press Open chat, and WaveCenter opens your chat with
them, or starts one if you have never talked. Picking someone you already
chat with opens the same conversation, so nobody ends up with two.

The open chat now reads newest first: the box you type in is at the top,
the latest message sits right under it, and older ones run down and scroll
off the bottom, so what you type lands where you are reading. A message the
other person sends appears at the top straight away, without reloading.

A search field finds messages in the open chat by the words in them
(capital letters don't matter), and says plainly when nothing matches.

Checked on the private test database with two throwaway members in two
browsers: the picker, newest-on-top order, a live reply in about a second,
search, and a reload all behaved as described. The task page's own chat
panel is unchanged.
