## 2026-11-24 — Website manager: save a section once, reuse it on many pages (#203)

You can now build a section once, such as a site header, a footer or a banner, and use it on as many pages as you like. In a page's editor, any section can be saved under a name. Another page can then insert it in one of two ways:

- **Linked**: the section follows the original. Change the original and every page using it changes at the same moment.
- **A plain copy**: the section starts out the same but is its own from then on.

A linked section can't be changed by accident on one page. Its settings are locked, and "Unlink" turns it into a plain copy you can edit. To change the original, edit a copy and click "Update the original". Before anything changes, it tells you how many pages will change.

Why it matters: shared parts of a website, like the header on every page, now have one place to change. Changing one doesn't mean editing every page by hand. The idea comes from StarCaster, along with its hard-won rule that one setting means one thing: "linked" means "follows the original", and nothing else.

Safety: the saved sections live in their own database table, locked down from the start. Only a role with Manage website can save or change one. Visitors can read one only once a published page uses it.

Still to come: the public web address for each page (WC-210) will show linked sections with their original's latest content. This change prepares for that.
