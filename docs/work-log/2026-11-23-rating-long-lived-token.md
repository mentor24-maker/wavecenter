## 2026-11-23 — AI rating stops by Nov 25: accept the long-lived Claude sign-in (#197)

The AI rating job on the Mac Mini rates tasks with Claude, billed to Dane's
monthly plan. It signed in through the Mini's browser login, which ends on or
before November 25. Last time (WC-181) the loop lanes moved to a long-lived
sign-in token that lasts about a year. The rating job did not: it had a
safety check that refused any sign-in that wasn't the browser one, so it
would have stopped rating when the browser login ran out.

Now the rating job reads the same token from Doppler and uses it. The safety
check still does its real job, keeping Dane's bill safe. An API key, which
would charge per call instead of using the plan, still stops the job before
anything is rated, even if the token is there too. The token never shows up
in the log or in the Mini's list of running programs. When the job cannot
sign in, its log now says how to fix that either way: make a new token, or
log in again.
