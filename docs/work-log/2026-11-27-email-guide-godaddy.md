## 2026-11-27 — Email setup guide still says Hostinger: update it for GoDaddy (#230)

New members were signing up and never getting their confirmation email,
because WaveCenter still sends sign-up emails through Supabase's built-in
sender, which only delivers to a few addresses. The fix is Dane's own clicks
in the email setup guide, but the guide sent him to Hostinger. The
domain's address book (DNS) moved to GoDaddy on 2026-11-06.

The guide's first step now walks through GoDaddy's real screens, using the
button and field names from GoDaddy's own help pages. It warns about the one
easy mistake (typing the full name, which GoDaddy then doubles). It lists the
records already there that must not be touched, because they keep the app and
the public website online, and it starts with a one-line check that the DNS
really is at GoDaddy. A new line near the top says why the guide matters now.
The infrastructure notes now say, with dates, that DNS is at GoDaddy and the
old Hostinger mailbox is gone. The older facts stay as history.
