## 2026-11-26 — Let website managers rename and delete a saved section (#217)

A saved section is a piece of a page, such as a header, a footer or a banner, saved once and reused on many pages. Until now one could never be renamed or removed after it was saved. Website managers can now do both from the section editor, with Rename and Delete beside the "Insert a saved section" picker.

Deleting is built so that no page breaks. Before anything is removed, the screen says how many pages use the section and asks to confirm. On yes, every one of those pages first gets its own copy of the section's current content. Only when all of them have saved is the saved section deleted. If even one page fails to save, nothing is deleted and the screen names that page. After a delete, visitors see exactly what they saw before, and each page's copy can now be edited on its own.

The database repeats the rule: only a role with the Manage website permission can rename or delete a saved section, even by going around the app. This was tested on the private test database, not the live one.
