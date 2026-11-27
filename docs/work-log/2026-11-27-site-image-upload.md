## 2026-11-27 — Let website managers upload pictures for the picture module (#223)

Until now, a website manager could only show a picture on a WaveCenter page by pasting the address of a picture that already lived somewhere else on the web. The picture module's settings now have an **Upload** button, so a manager can pick a photo from their own computer.

The photo goes from the browser straight into a new storage area for website pictures. It never passes through the web server and is never written to its disk. Anyone can look at these pictures, because visitors to a published page are not signed in. Only a role with the Manage website permission can add one. WaveCenter checks that before it hands out the one-time upload link, and the storage area checks it again on its own.

Only PNG, JPEG, GIF and WebP pictures of up to 5 MB are accepted. Anything else gets a plain message beside the button, and the old picture stays where it was. Once the photo is stored, its address fills the "Picture address" box and the preview shows it; the manager then saves the page as usual.

Old uploads are not cleared out when a picture is replaced. That is left for a later ticket if storage grows.

A fix after review: a big photo can take a few seconds to upload, and a manager may keep editing meanwhile. Before the fix, when the upload finished it put back the page as it was when the upload began, quietly undoing anything else changed in those seconds. Now the finished upload sets only its own picture's address, on the page as it is by then, so other edits and moves are kept, and nothing happens if that picture was removed. Also: a file just over 5 MB now says "5.1 MB" rather than a confusing "5.0 MB", the Upload button sits in a tidy row with no blank gap above it, and the migration got a later timestamp so it no longer shares one with the open group-chats pull request.
