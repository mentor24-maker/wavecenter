## 2026-11-24 — Website manager: first modules for headings, text, pictures and buttons (#202)

The website manager's sections now hold content. Each column of a section
(a "cell") can take four kinds of module: a heading, a block of text, a
picture and a button. In the section editor you add one to a cell, click
Edit to change it in a settings panel beside the page, move it up or down
or into another cell, or remove it, and Save keeps it with the sections.

Why it matters: this is the first content a visitor will eventually see, so
it is kept safe from the start. Text is WaveCenter's own simple formatting
(bold, italic, lists, links), never raw web code, so nothing typed into a
page can run in a visitor's browser. A picture must come from a secure
(https) address, and a button may only link to an ordinary web address or a
WaveCenter page such as /about. Anything else is refused in plain words,
both while typing and on Save. A damaged saved page is tidied when it is
read, so it never breaks the editor.

After review, three rough edges were fixed. Changing a section to a layout
with fewer columns used to hide the modules in the column that went away;
they now move into the first column at once, so nothing drops off the
screen. A picture's width box rounded every keystroke, so typing "50" ended
as 100; it now takes what is typed and tidies it when you leave the box.
And the Text box is locked while a save runs, so words typed during a save
can no longer vanish. A very long address in a non-Latin alphabet is now
refused while typing, instead of being saved and quietly cleared later.
