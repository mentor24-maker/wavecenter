## 2026-11-24 — Website manager: build a page from sections and layouts (#200)

A page of WaveCenter's website can now be laid out. Until today a page was
only a name and an address. Now an admin opens a page, clicks **Edit
sections**, and stacks up sections: bands across the page, each split into
one, two or three columns (equal, or uneven like a narrow sidebar beside a
wide column). Each section can have space above and below and a background
colour. The empty columns show where headings, text, pictures and buttons
will go in the next step.

The rules live in WaveCenter's core, not the screen, and the database repeats
the important ones: only a role with Manage website can change a page's
sections, and a page holds at most 50 sections. If something odd is ever
stored, the editor tidies it rather than breaking. Nothing is saved until
Save; the screen says what is unsaved, asks before you leave, and a save that
fails says so and keeps your work on screen.

The layouts are copied and adapted from Normie's page builder, as Dane chose
on WC-206.
