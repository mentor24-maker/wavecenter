-- Pictures uploaded for the website's picture module (WC-251). Until now a
-- website manager could only show a picture by pasting the address of one
-- that already lived somewhere else on the web; now they can upload one.
--
-- The stored copies live in a Supabase Storage bucket, never on the web
-- host's disk (engineering rule 5). Unlike the private `task-files` bucket,
-- this one is PUBLIC TO READ: visitors to a published page are not signed
-- in, so each picture has a plain https address anyone can open. Only a role
-- with the Manage website permission (site.edit, checked by private.may as
-- the site tables do) may add one. Pictures only (png, jpeg, gif, webp), at
-- most 5 MB: the same values as core/website.ts's SITE_IMAGE_UPLOAD_TYPES
-- and SITE_IMAGE_UPLOAD_MAX_BYTES, so the button and the bucket agree.
--
-- No update or delete rule: an uploaded picture is never overwritten (each
-- upload gets its own random folder), and clearing out old ones is a later
-- ticket. With no rule, no member may do either.
--
-- Additive only. Safe to re-run: the bucket is upserted and the policy is
-- dropped before it is made.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-images', 'site-images', true, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

drop policy if exists "site-images: a website manager adds one" on storage.objects;
create policy "site-images: a website manager adds one" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-images' and (select private.may('site.edit')));
