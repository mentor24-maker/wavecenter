## 2026-11-13 — Members have no chat window: add one that updates live (#166)

Members can now talk to each other in real time. This answers Dane's question
from 2026-11-12: "two WaveCenter users could chat with each other in real-time
in a dedicated window."

- **A Chat page.** The menu has a new **Chat** link after Members. The page
  lists your chats on the left, the one with the newest message on top, each
  showing who it is with, the start of the last message and when it was sent.
  The chat you open is on the right, with a box to type in. Enter sends, and
  Shift+Enter starts a new line. Every chat has its own link, so you can send
  someone straight to it.
- **Live.** While the page is open, a message from the other member appears
  in a second or so with no reload, and it appears only once. The page can
  only hear about chats you are in, so nobody else's conversation reaches your
  screen. If the live connection cannot start or drops, one line says
  "Live updates paused, reload to see new messages."
- **Start one from Members.** Every member's row, except your own, has a new
  Chat button. It opens your chat with that member. Clicking it again opens
  the same chat rather than a second one.
- **On a phone** only one half shows at a time: the list, or the open chat
  with a link back to the list.
- **Nothing is lost silently.** A message that fails to send stays in the box
  with the reason under it. Every empty screen says why it is empty.

Each message sent earns its sender the granular `sent_a_chat_message` point
that the earlier chat ticket set up.
