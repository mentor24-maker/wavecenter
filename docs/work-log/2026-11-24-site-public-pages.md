## 2026-11-24 — Website manager: show published pages at their own web address (#204)

Until now a page made in the website manager could be built and marked
published, but nobody could actually see it. Now every published page has its
own web address, `/site/<address>`, that anyone can open, signed in or not. It
draws the page's sections side by side as laid out, with their headings, text,
pictures and buttons. On a phone the columns stack into one.

A draft, or an address with no page, shows "There is no page at this address"
with a link Home instead of a blank screen. A member who manages the website
can see drafts in the manager, but the public address still hides them, so
everyone sees the same page. A published page's screen in the manager now has
a **View page** button.

The drawing is done by one shared piece, so the coming phone, tablet and
desktop preview (WC-211) shows exactly what visitors see.

Review caught one gap: a published page whose sections held nothing visible
yet (a fresh empty section, or a heading with no words) showed a blank screen.
Now the page says "This page has nothing on it yet." whenever nothing on it
would draw. And if the page cannot be read from the database, a visitor sees
a plain sentence; the technical error goes only to the server's log.
