## 2026-11-22 — Give Tags a CRUD Table (#179)

The Forum's Tags list could only add a tag. Now it works like the Topics
table: every tag can be opened, changed and deleted, by the member who added
it or an admin.

In place of a Parent column, tags have **Related Tags**, as Dane asked. Tick
Budget on Voting's edit page and both rows show the other: the link goes both
ways, and it is stored once, so it can never be doubled up or point a tag at
itself. Deleting a tag takes it off every other tag's list.

Dane chose "B" for the tag's own page: like a topic, it has a name, a short
web-address name (slug), a one-line description and rich-text details. The
table's headings sort when clicked and a filter box narrows the rows as you
type.

Why it matters: tags are how the Forum's discussions will be sorted, so
members need to keep them tidy (rename, merge by deleting, group by relating)
before tags are attached to topics and threads. The database itself enforces
who may change what, so the screen is not the only guard.
