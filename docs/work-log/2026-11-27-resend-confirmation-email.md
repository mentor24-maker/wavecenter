## 2026-11-27 — Add a 'Resend confirmation email' link to page (#228)

Before this, someone who registered and never got the confirmation email (or deleted it) was stuck on the "Check your email" screen with nothing to click. That screen now has a **Resend confirmation email** link. It opens a small box where they type their address again and press Send. WaveCenter then asks Supabase to send a new confirmation email, and its link signs them in.

The answer is worded the same for every address ("If that address is waiting to be confirmed, a new confirmation email is on its way"), so the form cannot be used to find out who has an account. If the email could not be sent, the page says so plainly. "Too many emails" is one such case. It never pretends the email went. Only the newest email's link signs a member straight in. An older link still confirms the address and sends them to Log in.
