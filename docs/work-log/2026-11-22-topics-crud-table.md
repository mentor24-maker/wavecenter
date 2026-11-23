## 2026-11-22 — Give Topics a CRUD table and details/editpage (#176)

The Forum's Topics list used to be add-and-look only. Now each topic can be
opened, changed and deleted, and the list works like a real table.

**What changed.** The Topics table has View, Edit and Delete on every row,
a Parent column, headings that sort when clicked, and a filter bar: a box
that narrows the list as you type, and a dropdown to show only one topic's
sub-topics (or only top-level ones). Each topic has its own page showing its
name, slug (a short web-address name such as `voting-rules`), parent, a
one-line description and longer details written with the same formatting
toolbar as task comments (bold, italic, lists, links). An edit page changes
all of those.

**Who may change a topic.** The member who added it, and admins: Dane's
choice "A" on the ticket. For anyone else Edit and Delete are greyed out.
The database refuses them too, so going around the screen doesn't work
either.

**Why it matters.** Topics are what Forum discussions will hang from, so
members need to be able to describe, group and tidy them. Deleting a topic
never takes other members' topics with it: its sub-topics just lose their
parent. The database also refuses any loop (a topic under its own
sub-topic), so the tree can't knot itself.

**Checked.** The new database rules were proved on the private test
database (13 new checks, all passing). The screens were clicked through in
a headless browser: sorting, filtering, editing with bold text, refusing a
taken slug while keeping what was typed, and deleting a parent.
