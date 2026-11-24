## 2026-11-23 — Develop website manager under Admin (#196)

WaveCenter has the start of its own website manager, a page builder like the
ones in StarCaster and Normie. Dane chose to start from Normie's smaller
builder and bring in StarCaster's best parts a piece at a time.

What an admin can do now: open **Admin → Website**, see the list of the
site's pages (name, address, draft or published), and make a new page by
giving it a name and an address. A new page is an empty draft; building what
is on it comes next. If an address is already taken, the screen says so in
plain words. A member whose role is not allowed to manage the website is told
that, instead of seeing an empty screen.

Behind it: a new table for the pages, locked down from the moment it exists,
so only roles with the new **Manage website** permission (admins, to start)
can see drafts or make pages, and anyone can see a page once it is published.
The rule about who may do this lives in WaveCenter's core, with tests.

The plan for the rest, `docs/WEBSITE_MANAGER.md`, compares the two builders
and lists seven follow-up tickets, already filed in order (WC-207 to WC-213):
changing, publishing and deleting a page; building a page from sections;
the first content blocks; showing published pages at their own web address;
previewing on phone, tablet and desktop; reusable sections; and points in the
game for website work.
