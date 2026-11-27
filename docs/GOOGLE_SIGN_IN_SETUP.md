# Switching on Google sign-in

A click-by-click guide for Dane. When it is done, the **Continue with Google**
button on the log-in page, the home page and the register page signs a member
in with their Google account in one click. A first-time Google sign-in makes
their WaveCenter account and records their "Joined WaveCenter" point, the same
as registering with an email.

Until it is done, the button is already on the pages and says
**"Google sign-in is not switched on yet. Use your email and password for
now."** Email and password keep working throughout.

Four steps, in order. Allow about 20 minutes. Only Dane does steps 1, 2 and
the Doppler half of step 3: they need his Google and Supabase sign-ins, and
the client secret is never typed into a terminal or pasted into a chat.

**Words used here.** *OAuth* is the standard way one site lets you sign in
with your account from another (here, Google). Google gives WaveCenter a
*client id* (public, like a username) and a *client secret* (private, like a
password). The *consent screen* is the page Google shows a member asking
"Allow WaveCenter to see your name and email?". A *redirect URI* is the one
address Google is allowed to send a member back to afterwards.

**Nothing changes on Vercel.** The secret lives in Supabase, not in the app,
so there is no new Vercel setting and no redeploy.

---

## Step 1. Google Cloud: make the OAuth client

**Your decision here:** which Google account owns this. It should be one you
will keep for good (WaveCenter's sign-in stops if the account is closed). Sign
in with that account for every part of this step.

**1a. A project.**

1. Open [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate).
2. Project name: `WaveCenter`. Leave Location as offered. Click **Create**.
3. You should see a notification "Create Project: WaveCenter" with a tick.
   In the project picker at the top of the page, choose **WaveCenter**.

**1b. The consent screen.**

1. Open [console.cloud.google.com/auth/branding](https://console.cloud.google.com/auth/branding).
   If it says "Google Auth Platform not configured yet", click **Get started**.
2. App name: `WaveCenter` (or the name you want members to see; **your
   choice**). User support email: your address. Click **Next**.
3. Audience: **External**. Click **Next**.
4. Contact information: your address. Click **Next**, tick the agreement,
   click **Continue**, then **Create**.
5. Open [console.cloud.google.com/auth/branding](https://console.cloud.google.com/auth/branding)
   again. Under **Authorised domains**, click **Add domain** and type
   `wavecenter.com`. Then add `dewzjgnydxwwblfuvyhb.supabase.co` (WaveCenter's
   Supabase address, which Google's screen sends members through; if Google
   shortens it to `supabase.co`, that is fine). A logo is optional (**your
   choice**; a logo makes Google ask for a review, which can take days, so
   leaving it off is quicker). Click **Save**.
6. Open [console.cloud.google.com/auth/audience](https://console.cloud.google.com/auth/audience).
   Under **Publishing status** it says "Testing". Click **Publish app**, then
   **Confirm**. You should see "In production". (In "Testing", only the
   Google accounts you list by hand can sign in.)

**1c. The client.**

1. Open [console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients)
   and click **Create client**.
2. Application type: **Web application**. Name: `WaveCenter`.
3. Under **Authorised JavaScript origins**, click **Add URI** and type
   `https://app.wavecenter.com`.
4. Under **Authorised redirect URIs**, click **Add URI** twice and type these
   two, exactly:
   - `https://dewzjgnydxwwblfuvyhb.supabase.co/auth/v1/callback` (the live
     site, through WaveCenter's Supabase)
   - `http://127.0.0.1:54521/auth/v1/callback` (the test copy on the Mac Mini)
5. Click **Create**. You should see a box "OAuth client created" showing a
   **Client ID** (ends in `.apps.googleusercontent.com`) and a **Client
   secret** (starts `GOCSPX-`). Keep this box open for steps 2 and 3, or
   click **Download JSON** and keep the file somewhere private (not in the
   WaveCenter folder).

## Step 2. Supabase: switch Google on

1. Open [supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/providers](https://supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/providers)
   and sign in.
2. Click **Google** in the list. Turn on **Enable Sign in with Google**.
3. Paste the **Client ID** into "Client IDs", and the **Client secret** into
   "Client Secret (for OAuth)". Leave the other switches as they are.
4. The box shows a **Callback URL (for OAuth)**. It should read
   `https://dewzjgnydxwwblfuvyhb.supabase.co/auth/v1/callback`, the same as
   the first redirect URI in step 1c. Click **Save**.
5. You should see "Successfully updated settings", and Google now shows
   **Enabled** in the list.
6. Open [supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/url-configuration](https://supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb/auth/url-configuration).
   Under **Redirect URLs** you should already see `https://app.wavecenter.com/**`,
   `https://app-wavecenter.vercel.app/**`,
   `https://app-wavecenter-*-dane-of-earth.vercel.app/**` and
   `http://localhost:3000/**`. Those already cover the new `/auth/callback`
   address on the live site, every preview and local development, so there
   is nothing to add. If one is missing, click **Add URL** and add it.

**An existing member who signs in with Google** using the same email address
as their email-and-password account lands in that same account: Supabase
joins the two by itself. Their password keeps working too.

## Step 3. Doppler: the keys for the test copy on the Mac Mini

This step is only for the test copy of WaveCenter that runs on the Mac Mini.
The live site does not need it. You can leave it for later.

1. Open [dashboard.doppler.com](https://dashboard.doppler.com), choose the
   **wavecenter** project, then the **dev** config.
2. Click **Add Secret** and add two:
   - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`: the Client ID
   - `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`: the Client secret
3. Click **Save**. You should see both names in the list, values hidden.
4. Tell an agent session "Google keys are in Doppler". It restarts the test
   copy with them, from the main WaveCenter folder on the Mini:

   ```bash
   supabase stop && doppler run --project wavecenter --config dev -- supabase start
   ```

   (`supabase/config.toml` reads the two keys by name, never their values.
   A test copy started without them still shows the button, but Google
   refuses it.)

## Step 4. Last check

1. Open a private (incognito) window and go to
   [app.wavecenter.com/sign-in](https://app.wavecenter.com/sign-in).
2. Click **Continue with Google**. You should see Google's account chooser,
   saying it will sign you in to WaveCenter (or the app name you chose).
3. Choose an account. You should land on WaveCenter's home page, signed in,
   with that account's name in the header.
4. Open [app.wavecenter.com/profile](https://app.wavecenter.com/profile). The
   email shown is the Google address.
5. Optional: in the same private window, log out, click **Continue with
   Google**, and on Google's "Sign in to WaveCenter" page click **Cancel**. You should land back on the
   log-in page with "The Google sign-in did not finish: it was cancelled at
   Google."
