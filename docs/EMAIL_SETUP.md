# Switching on WaveCenter email (Resend)

A click-by-click guide for Dane. When it is done:

- **Members-page messages arrive by email.** Today they are saved but never
  sent, because WaveCenter has no Resend key.
- **Sign-in links reach everyone.** Today they go through Supabase's built-in
  sender, which only delivers to members of the Supabase organisation, a few
  an hour.

**Why this matters now.** Until Step 4 is done, every new member who is not
in the Supabase organisation signs up and is stuck unconfirmed: Supabase
says "confirmation sent", but its built-in sender never delivers the email.
On 2026-11-27, 2 of WaveCenter's 7 accounts were stuck that way.

Members-page messages come from **`WaveCenter <noreply@wavecenter.com>`**
(Dane's choice, 2026-11-01). Account emails (confirm your email, confirm a
new address, reset your password) come from **`WaveCenter Admin
<noreply@wavecenter.com>`** (Dane's "A", WC-257, 2026-11-27). A member's message has no reply-to address: it names its
sender and says to answer on Your profile in WaveCenter, so a reply reaches
nobody's inbox and shows nobody's address (Dane's "A", 2026-11-01).

Five steps, in order. Allow about 30 minutes, most of it waiting for DNS.
Only Dane does these steps: three of them involve the secret key, and the key
is never typed into a terminal or pasted into a chat.

**Words used here.** *DNS* is the internet's address book: records that say
which server handles each name. *Verifying a domain* proves to Resend that
WaveCenter owns `wavecenter.com`, so mail from it is trusted rather than
treated as spam. *SMTP* is the standard way one mail system hands an email to
another. Supabase uses it to hand sign-in emails to Resend.

---

## Step 1. Verify `wavecenter.com` in Resend

The domain's DNS is at **GoDaddy** since 2026-11-06 (name servers
`ns43.domaincontrol.com` and `ns44.domaincontrol.com`; `domaincontrol.com`
is GoDaddy's). Until then it was at Hostinger, whose name servers were
`ns1.dns-parking.com` and `ns2.dns-parking.com`.

**Before you start** (an agent session can run this, or Dane can paste it
into a terminal in the WaveCenter folder):

```
dig +short NS wavecenter.com
```

It should print these two lines, in either order:

```
ns43.domaincontrol.com.
ns44.domaincontrol.com.
```

If it prints anything else, the DNS has moved again: stop and ask an agent
session to update this guide before adding any record.

**1a. In Resend.**

1. Open [resend.com/domains](https://resend.com/domains) and sign in.
2. Click **Add Domain**. Type `wavecenter.com`. Leave the region as offered
   (North Virginia, `us-east-1`). Click **Add**.
3. You should see a page listing **DNS records**: usually an `MX` record and a
   `TXT` record named `send`, a `TXT` record named `resend._domainkey`, and
   sometimes an optional `_dmarc` record. Leave this tab open.

Resend puts its records on `send.wavecenter.com` and `resend._domainkey`, not
on the bare domain, so they sit beside the records already at GoDaddy
without changing any of them.

**Already at GoDaddy: do not touch these.**

| Type | Name | What it does |
|---|---|---|
| `CNAME` | `app` | sends `app.wavecenter.com` to this app on Vercel |
| `A` | `@` | sends `wavecenter.com` (the public website) to Vercel |
| `CNAME` | `www` | sends `www.wavecenter.com` to Vercel |

Changing or deleting any of them takes the app or the public website off the
internet. (`@` is GoDaddy's name for the bare domain, `wavecenter.com`
itself.)

There are also two `MX` records on `@` (`mx1.hostinger.com`,
`mx2.hostinger.com`) and an SPF `TXT` record on `@`
(`v=spf1 include:_spf.mail.hostinger.com ~all`), copied over from Hostinger.
They point at the Hostinger mailbox, which went down with its plan on
2026-11-05, so no mail reaches `@wavecenter.com` addresses today. Resend does
not need them and they do not get in its way: leave them for this guide.
Whether to delete them is a separate decision.

**1b. In GoDaddy, add each record Resend shows.**

1. Open [dcc.godaddy.com/control/portfolio](https://dcc.godaddy.com/control/portfolio)
   and sign in. This is GoDaddy's **Domain Portfolio**.
2. Click `wavecenter.com`. That opens its **Domain Settings** page.
3. Click **DNS**. You should see the record list, including the `app`
   CNAME and the `www` CNAME from the table above.
4. For each record on the Resend page:
   - Click **Add New Record**.
   - **Type**: choose the type Resend shows (`MX` or `TXT`).
   - **Name**: GoDaddy wants the name "without the domain name". Type only
     the part Resend shows **before** `.wavecenter.com`, such as `send` or
     `resend._domainkey`. GoDaddy adds `.wavecenter.com` itself, so typing
     `send.wavecenter.com` here would create
     `send.wavecenter.com.wavecenter.com`, and Resend would never find it.
   - **Value**: use the copy button on the Resend page and paste. A DKIM
     value (the long `resend._domainkey` one, a signature that proves an
     email really came from WaveCenter) must be pasted whole.
   - **Priority** (only for `MX`): the number Resend shows, usually `10`.
     GoDaddy may warn that changing MX records can interrupt email. That
     warning is about mail *to* the domain; this `MX` record is on `send`
     only, for Resend, and touches nothing else.
   - **TTL** (how long other computers may remember the record): leave
     GoDaddy's default, 1 hour.
   - Click **Save**. (If you used **Add More Records** to fill in several at
     once, the button is **Save All Records**.) The record should appear in
     the list.
5. The `_dmarc` record is optional. Add it only if GoDaddy's list has no
   `_dmarc` record already. If one exists, leave it alone.

**1c. Back in Resend.**

1. Click **Verify DNS Records** (or **Restart verification**).
2. Each record turns **Verified** (green), usually within 5–30 minutes,
   sometimes a few hours. The domain then shows **Verified**.

If a record stays **Failed** after an hour, the usual cause is the Name field:
open that record in GoDaddy's DNS list and check it holds only `send` or
`resend._domainkey`, with no `.wavecenter.com` on the end.

---

## Step 2. Create a Resend API key with sending access only

1. Open [resend.com/api-keys](https://resend.com/api-keys).
2. Click **Create API Key**.
   - **Name**: `WaveCenter`
   - **Permission**: **Sending access**. Not Full access: this key can only
     send email, so if it ever leaked, nobody could use it to change the
     account.
   - **Domain**: `wavecenter.com`
3. Click **Add**. Resend shows the key **once**, starting `re_`. Click the copy
   button. Keep the tab open until steps 3 and 4 are done. If you lose it,
   delete the key and make a new one.

---

## Step 3. Put the key into Doppler and Vercel, then redeploy

**3a. Doppler** holds WaveCenter's keys for scripts and the Mac Mini.

1. Open [dashboard.doppler.com](https://dashboard.doppler.com), then project
   **wavecenter**, then config **dev**.
2. Click **Add Secret**. Name: `RESEND_API_KEY`. Value: paste the key.
3. Click the purple **Save** in the upper right.
4. Go back to **wavecenter**, open config **prd**, and do the same.

**3b. Vercel** holds the copy the live app uses.

1. Open [vercel.com/dane-of-earth/app-wavecenter/settings/environment-variables](https://vercel.com/dane-of-earth/app-wavecenter/settings/environment-variables).
2. Key: `RESEND_API_KEY`. Value: paste the key. Environments: tick
   **Production** and **Preview** (not Development). Mark it **Sensitive** if
   the option is there.
3. Click **Save**.
4. Check the list also has `SUPABASE_SERVICE_ROLE_KEY` for **Production** and
   **Preview**. The server uses it to look up the recipient's address (no
   member's session can), so without it a message is saved but not emailed,
   and the form says WaveCenter cannot look up addresses yet. If it is
   missing, an agent session copies it from Doppler `prd`; it stays on the
   server and never reaches the browser.

**3c. Redeploy.** Vercel reads keys only when it builds (engineering rule 4),
so the saved key does nothing until a fresh build.

1. Open [vercel.com/dane-of-earth/app-wavecenter/deployments](https://vercel.com/dane-of-earth/app-wavecenter/deployments).
2. On the top deployment marked **Production**, click the **⋯** menu, then
   **Redeploy**, then **Redeploy** again.
3. Wait for **Ready** (about two minutes).

**Check it** (an agent session can run this, or Dane can paste it into a
terminal in the WaveCenter folder):

```
npm run doctor
npm run email:test -- --to daneofearth@gmail.com
```

`doctor` should show `RESEND_API_KEY  present  present`. `email:test` should
print `sent: Resend accepted the test email … (id …)`, and the email should
arrive at `daneofearth@gmail.com` within a minute. If it prints
`Resend refused the email (HTTP 403): … not verified`, step 1 is not finished
yet.

---

## Step 4. Send sign-in links through Resend (Supabase custom SMTP)

1. Open [supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/smtp](https://supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/smtp)
   (Authentication → Emails → **SMTP Settings**).
2. Turn on **Enable custom SMTP** and fill in:

   | Field | Value |
   |---|---|
   | Sender email address | `noreply@wavecenter.com` |
   | Sender name | `WaveCenter Admin` |
   | Host | `smtp.resend.com` |
   | Port number | `465` |
   | Username | `resend` |
   | Password | paste the Resend key from step 2 |

   Leave the minimum interval as it is.
3. Click **Save changes**.
4. Raise the sending limit. Open
   [supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/rate-limits](https://supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/rate-limits)
   (Authentication → **Rate Limits**). Set **Rate limit for sending emails**
   to `100` per hour. Click **Save changes**. Supabase allows a higher limit
   only once custom SMTP is on.

**Check it.** In a private browser window, open
[app.wavecenter.com](https://app.wavecenter.com), ask for a sign-in link to
your own address, and open it in that same window. The email should come from
**WaveCenter Admin &lt;noreply@wavecenter.com&gt;**, and the link should sign
you in.

**If sign-in emails stop arriving**, switch it back: open the SMTP Settings
page again, turn **Enable custom SMTP** off, and click **Save changes**.
Supabase's built-in sender takes over again at once. Then check the six
fields above, most often the password or the port.

Supabase has one sender name for every account email it sends. It is
**`WaveCenter Admin`** for all of them, the reset-password email included
(Dane's "A" on WC-257, 2026-11-27, replacing "WaveCenter" chosen on
2026-11-02). If the SMTP page already says `WaveCenter`, change only that one
field and click **Save changes**.

---

## Step 5. Give the three account emails WaveCenter's look

All three emails Supabase sends for WaveCenter accounts share one look: the
water-drop picture as the background, the logo and the WaveCenter name at
the top, and the words and button inside a rounded pod of 75%-opaque white
(WC-257). Each design lives in a file in
[`supabase/templates/`](../supabase/templates/). The local test stack reads
them from there; the live project needs a pasted copy of each. This step does
not need step 4, but until step 4 is done the emails still come from
Supabase's own address.

1. Open [supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/templates](https://supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/templates)
   (Authentication → Emails → **Templates**).
2. For each row of this table, click the template name, then:
   - **Subject**: type the subject exactly as shown.
   - **Message body**: select everything in the box and delete it, then
     paste the whole of the file (an agent session can put it on your
     clipboard). The preview beside it should show the water-drop picture,
     the logo and the white pod.
   - Click **Save changes**.

   | Template in Supabase | Subject | File to paste |
   |---|---|---|
   | **Confirm signup** | `Confirm your WaveCenter email` | [`confirmation.html`](../supabase/templates/confirmation.html) |
   | **Change email address** | `Confirm your new WaveCenter email address` | [`email_change.html`](../supabase/templates/email_change.html) |
   | **Reset password** | `Reset your WaveCenter password` | [`recovery.html`](../supabase/templates/recovery.html) |

**Check it.** Open [app.wavecenter.com/forgot-password](https://app.wavecenter.com/forgot-password),
type your own address and click the button. The email should come from
**WaveCenter Admin** (once step 4 is done), show the water-drop background
with the logo and the white pod, and its **Set a new password** button
should open WaveCenter's set-a-new-password page.

When any of the three files changes, paste that one again.

---

## Last check: a message from the Members page

1. Open [app.wavecenter.com/members](https://app.wavecenter.com/members).
2. Send yourself a message.
3. The form should say it was sent (not "saved but not emailed"), and the
   email should arrive at your inbox from `noreply@wavecenter.com`.

## Changing the key later

Make a new key in Resend (step 2), then replace the value in all four places:
Doppler `dev` and `prd`, Vercel, and Supabase SMTP. Redeploy Vercel. Then
delete the old key in Resend.
