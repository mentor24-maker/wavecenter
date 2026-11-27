## 2026-11-27 — Give admin user ability to see email address in Members CRUD (#229)

Admins can now see every member's email address on the Members page, along
with how each member signs in: with Google, with an email link and password,
or both. The two new columns sort when clicked, and the filter box finds a
member by part of their address.

Email addresses are private, so the protection sits in the database itself,
not just on the screen. A new database function hands out the addresses and
refuses anyone who is not an admin; the automatic checks prove that a
viewer, editor, contributor, reviewer and a signed-out visitor are each
turned away. Every other role's Members page looks exactly as it did and
never receives anyone else's address. If the addresses cannot be read, an
admin sees a plain message saying so, and the rest of the table still shows.
