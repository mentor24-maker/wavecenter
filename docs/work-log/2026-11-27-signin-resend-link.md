## 2026-11-27 — Log-in says email not confirmed: link it to the resend form (#231)

Some new members never got their confirmation email. When they came back and tried to log in, WaveCenter said only "open the link in the email we sent", with no way to ask for that email again. The "Resend confirmation email" box added the day before (#228) appeared only straight after registering, a screen a returning member never sees.

Now the log-in message ends with a link, "Never got it? Send the confirmation email again." It opens the Register page with the resend box already open, so the member types their address, clicks Send and gets a fresh email. This is the way Dane chose for the stuck accounts to get their link once email delivery is fixed (WC-261). The link's address is fixed, so no one's email ever appears in the address bar. The resend still answers the same way for any address, so it cannot reveal who has an account.

Checked on the private test copy of WaveCenter: logging in to a new, unconfirmed account showed the link on both log-in screens, and the link opened the resend box. A send that was refused for coming too soon showed its error, not a false "on its way". A second send delivered a new email, and its link confirmed the account so the member could log in.
