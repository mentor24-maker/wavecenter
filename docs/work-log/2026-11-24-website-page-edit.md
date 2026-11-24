## 2026-11-24 — Website manager: change, publish and delete a page (#199)

Until now, the website manager under Admin could only make a page and list
it. Now each page in the list opens on its own screen, showing its name, its
address, whether it is published, and when it was made and last changed.
From there, someone whose role has the Manage website permission can rename
it, give it a new address, publish it or take it back to a draft, and delete
it (after a plain "are you sure" step).

The same rules hold everywhere: a page needs a name, its address must be
lower-case words joined by hyphens, and no two pages share an address. The
database repeats the "Manage website only" rule, so nobody can get around it
by going straight at the data. Every save is read back, and one that did not
stick says so.

This was tested on the private test database, never the live one; the
database changes reach live only when Dane says merge.
