# Switching on WaveCenter email (Resend)

A click-by-click guide for Dane. When it is done:

- **Members-page messages arrive by email.** Today they are saved but never
  sent, because WaveCenter has no Resend key.
- **Sign-in links reach everyone.** Today they go through Supabase's built-in
  sender, which only delivers to members of the Supabase organisation, a few
  an hour.

Email comes from **`WaveCenter <noreply@wavecenter.com>`** (Dane's choice,
2026-11-01). Replies go to `daneofearth@gmail.com`.

Four steps, in order. Allow about 30 minutes, most of it waiting for DNS.
Only Dane does these steps: three of them involve the secret key, and the key
is never typed into a terminal or pasted into a chat.

**Words used here.** *DNS* is the internet's address book: records that say
which server handles each name. *Verifying a domain* proves to Resend that
WaveCenter owns `wavecenter.com`, so mail from it is trusted rather than
treated as spam. *SMTP* is the standard way one mail system hands an email to
another. Supabase uses it to hand sign-in emails to Resend.

---

## Step 1. Verify `wavecenter.com` in Resend

The domain's DNS is at **Hostinger** (name servers `ns1.dns-parking.com` and
`ns2.dns-parking.com`, checked 2026-11-01). It is the same place the `app`
record was added on 2026-10-12.

**1a. In Resend.**

1. Open [resend.com/domains](https://resend.com/domains) and sign in.
2. Click **Add Domain**. Type `wavecenter.com`. Leave the region as offered
   (North Virginia, `us-east-1`). Click **Add**.
3. You should see a page listing **DNS records**: usually an `MX` record and a
   `TXT` record named `send`, a `TXT` record named `resend._domainkey`, and
   sometimes an optional `_dmarc` record. Leave this tab open.

Resend puts its records on `send.wavecenter.com` and `resend._domainkey`, not
on the bare domain. **Your Hostinger mailbox keeps working.** Do not change
the existing `MX` records (`mx1.hostinger.com`, `mx2.hostinger.com`) or the
existing SPF `TXT` record on `@`.

**1b. In Hostinger, add each record Resend shows.**

1. Open [hpanel.hostinger.com/domains](https://hpanel.hostinger.com/domains)
   and sign in.
2. Find `wavecenter.com` and click **Manage**. In the left menu click
   **DNS / Nameservers**. You should see the record list, including the `app`
   CNAME.
3. For each record on the Resend page, in **Manage DNS records**:
   - **Type**: the type Resend shows (`MX` or `TXT`).
   - **Name**: only the part Resend shows **before** `.wavecenter.com`, such
     as `send` or `resend._domainkey`. Hostinger adds the domain itself.
     Typing `send.wavecenter.com` would create `send.wavecenter.com.wavecenter.com`.
   - **Points to / TXT value**: use the copy button on the Resend page and
     paste. A DKIM value is long; it must be whole.
   - **Priority** (only for `MX`): the number Resend shows, usually `10`.
   - **TTL**: leave the default.
   - Click **Add Record**. It should appear in the list below.
4. The `_dmarc` record is optional. Add it only if Hostinger has no `_dmarc`
   record already. If one exists, leave it alone.

**1c. Back in Resend.**

1. Click **Verify DNS Records** (or **Restart verification**).
2. Each record turns **Verified** (green), usually within 5–30 minutes,
   sometimes a few hours. The domain then shows **Verified**.

If a record stays **Failed** after an hour, the usual cause is the Name field:
open that record in Hostinger and check it holds only `send` or
`resend._domainkey`.

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
   | Sender name | `WaveCenter` |
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
**WaveCenter &lt;noreply@wavecenter.com&gt;**, and the link should sign you in.

**If sign-in emails stop arriving**, switch it back: open the SMTP Settings
page again, turn **Enable custom SMTP** off, and click **Save changes**.
Supabase's built-in sender takes over again at once. Then check the six
fields above, most often the password or the port.

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
