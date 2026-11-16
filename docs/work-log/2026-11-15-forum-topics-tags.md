## 2026-11-15 — Add a Topics section on the Forum page. (#170)

The Forum page used to only say what the Forum is for and that it was not built yet. Now it has its first working section: **Topics** on the left and **Tags** on the right. Each side has an "Add Topic" or "Add Tag" box that folds away until you click it, sitting above a table of what members have added so far. The two sides line up row for row, the way Dane asked, and on a phone they stack one above the other.

Any member can add a topic or a tag. The list never holds the same name twice: adding "Governance" when "governance" is already there is refused with a plain message, and what you typed stays in the box. A blank name is refused too. An empty table says it is empty and how to fill it.

Behind the screen are two new database tables, one for topics and one for tags. Each has its access rules switched on from the moment it was made: every member can see everything and add in their own name, nobody can change or delete an entry yet, and a visitor who is not signed in sees nothing. Twelve new automatic checks prove those rules on the private test database. Tags are only listed for now. Attaching tags to topics, threads, editing and deleting, and points for adding a topic are later tickets.
