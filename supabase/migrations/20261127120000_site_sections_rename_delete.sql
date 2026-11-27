-- Renaming and deleting a saved section (WC-246; the first saved sections
-- are 20261124160000_site_sections.sql, WC-212, which left both out on
-- purpose). A website manager may now give an original a new name, or
-- delete it, from the section editor.
--
-- Deleting is done in core (core/website.ts, deleteSavedSection): every page
-- that follows the original is first rewritten so each linked section of it
-- becomes a plain copy of its current content, and only then is the row
-- deleted. So no page is left following an original that is gone. The
-- database only says who may: a role with the Manage website permission
-- (site.edit), the same rule as saving or changing one.
--
-- A rename is checked by the name's existing rule (1 to 80 characters,
-- SITE_SAVED_SECTION_NAME_MAX); the existing update policy already limits
-- every change to a website manager, and the updated_at trigger stamps it.
-- Who saved it and when stay the database's: only the name and the content
-- are granted for update.
--
-- Additive only. Safe to re-run: grants repeat harmlessly and the policy is
-- dropped before it is made.

grant update (name) on public.site_sections to authenticated;
grant delete on public.site_sections to authenticated;

drop policy if exists "site_sections: a website manager deletes one" on public.site_sections;
create policy "site_sections: a website manager deletes one" on public.site_sections
  for delete to authenticated using ((select private.may('site.edit')));

notify pgrst, 'reload schema';
