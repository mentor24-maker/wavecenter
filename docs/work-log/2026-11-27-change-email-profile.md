## 2026-11-27 — Users should be able to change their email in profile settings (#225)

Members can now change the email address on their account from **Your profile**.
Until today the only account change was the password, so a member whose address
changed was stuck with the old one.

The scoop Dane asked for: a member *is* their account id, not their email. No
WaveCenter table keeps an email; the address lives only on the sign-in account,
where it is used for logging in, password resets, delivering messages and the
header name when a member has no display name. All of those follow a new address
automatically, so tasks, points and messages stay put.

How it works: the new "Email address" section shows the current address and a
"Change email" button. Supabase then emails a confirmation link to the old and
the new address, so nobody can take over an account just by switching its email.
The page says plainly that the change is waiting, keeps saying so after a reload,
and names every failure (address already in use, too many emails, signed out)
instead of pretending it worked. Both links come back to the profile page, which
reports what the account really shows.

Tested end to end on the private test database: change requested, both emails
arrived, both links clicked, then logged in with the new address and found the
same account and the same points. Still open: whether the hosted Supabase
project has "Secure email change" switched on. Only the dashboard shows that.
