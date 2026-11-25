## 2026-11-25 — Change 'Chat' to 'Comm' and upgrade system (#206)

This is the first step of the Comm epic. Members used to have two separate ways to talk to each other. Chat (the header link) was live conversation. Messages (on Your profile) worked like email: saved, and also emailed. Both are now in one place, **Comm**, with a **Sync / Async** switch at the top:

- **Sync** is the live chat window, the same as before.
- **Async** is Messages: sent and received, with filter, sort, Reply, Star, Trash and Send Message. These work exactly as before, so a message still saves, emails and earns its point the same way.

The address shows which mode you are in (`/comm?mode=async`), so a reload or a shared link opens the same mode. As Dane chose ("C"), Comm has its own address, `/comm`, and old `/chat` links forward there. Messages moved off Your profile, which now has a line pointing to Comm. The email a member gets for a new message now says to answer in Comm.

Nothing in the database changed, so no saved message or chat can be lost. Formatting differences between the two modes, such as a rich text editor for Async, are left for later tickets in the epic.
