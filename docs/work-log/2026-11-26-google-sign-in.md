## 2026-11-26 — Set up OAuth signup/login with Google (#215)

Members can now join or log in with their Google account in one click. A
**Continue with Google** button sits on the log-in page, the signed-out home
page and the register page; the email-and-password forms are unchanged.

Google's half of the setup can only be done by Dane (his Google and Supabase
sign-ins), so until he does it the button says plainly "Google sign-in is not
switched on yet" instead of showing a raw error page. His part is written up
click by click in `docs/GOOGLE_SIGN_IN_SETUP.md`. A sign-in cancelled at
Google, or one that fails on the way back, lands on the log-in page with a
plain message saying it did not finish.

A first Google sign-in makes the member's account, and the database records
their "Joined WaveCenter" point in the same save, exactly as for email
registering. No secret is in the repository: the test copy on the Mac Mini
reads Google's keys from Doppler by name, and the live keys live only in
Supabase.
