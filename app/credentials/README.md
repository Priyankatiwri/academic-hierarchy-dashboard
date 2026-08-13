# Google sign-in setup (OAuth — no service account needed)

The Prof signs in with their own Google account; the app stores a refresh token so scheduled
sync can read Drive on their behalf without them needing to be present at sync time. No
service-account JSON key, and no manually sharing folders with a robot email — the Prof already
owns (or already has access to) the folders their students submit into, so signing in grants
exactly the access needed.

This still requires a **one-time** Google Cloud project + OAuth client registration — Drive API
access always needs *some* Google-registered credential, OAuth or service account. What this
removes is the JSON key file and the per-folder sharing step the service-account approach needed.

## Setup

Google renamed and restructured this flow (it's now called **Google Auth Platform**, not the
old single-page "OAuth consent screen") — the steps below match the current UI.

1. **Google Cloud Console** → create/select a project → **APIs & Services → Library** → enable
   the **Google Drive API**.
2. **APIs & Services → OAuth consent screen** now lands on **Google Auth Platform → Overview**,
   showing "Google Auth Platform not configured yet." Click **Get started** and step through
   the wizard:
   - **App Information**: an app name (e.g. "Academic Dashboard") and your support email.
   - **Audience**: choose **External** (or **Internal** if everyone using this is on the same
     Google Workspace organization) — this replaced the old "User type" field.
   - **Contact Information**: your email, as the developer contact.
   - **Finish**: check the agreement checkbox → **Continue** → **Create**.
3. The left sidebar (Overview / Branding / Audience / Clients / Data Access / Verification
   Center / Settings) is now active. Configure three of those tabs:
   - **Audience** tab → scroll to **Test users** → **Add users** → add yourself (and any other
     Prof who'll use this). While **Publishing status** stays **Testing** — the default, fine
     indefinitely for a small private tool — only listed test users can sign in, and **no
     Google verification review is required**.
   - **Data Access** tab → **Add or remove scopes** → search for and check
     `https://www.googleapis.com/auth/drive` (the **full** scope, not `.../drive.readonly` —
     the app now also revokes student Drive access after a task's deadline + grace period,
     which is a write operation the readonly scope can't do) → **Update** → **Save**.
     (`.../auth/userinfo.email` is typically already present under "non-sensitive scopes" by
     default — add it too if it isn't.) Drive scopes are classified as **restricted**, so Google
     will nudge you toward verification if you ever try to move to production — ignore that and
     stay in Testing; verification isn't required for test users.
   - **Clients** tab → **Create Client** → Application type **Web application** → give it a
     name → under **Authorized redirect URIs** add `http://localhost:3000/auth/google/callback`
     for local dev (add your deployed URL's equivalent later, e.g.
     `https://your-app.onrender.com/auth/google/callback`, updating it any time the deployed URL
     changes) → **Create**. This is what generates the **Client ID** and **Client Secret** — the
     old "APIs & Services → Credentials → Create Credentials → OAuth client ID" path now lives
     here under **Clients**.
4. Copy the **Client ID** and **Client Secret** into `.env`:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI` (must exactly match one of the redirect URIs from the Clients step)
5. Start the app, open the dashboard, click **Connect Google Drive**, sign in, approve access.
   That's it — no per-folder sharing step, no key file to protect.

## ⚠️ If you already had a `drive.readonly` connection from before

Reconnecting with the upgraded scope takes effect immediately — the **next** sync (manual click
or the 15-minute cron, whichever comes first) will revoke Drive access for every task that's
already past its deadline + grace period, since that's a one-time action gated only on the task
not having been revoked yet, not on how recently you reconnected. If you have existing overdue
tasks you're not ready to lock down yet, hold off reconnecting until you are.

## If sync starts failing with an auth error

Google only issues a refresh token reliably when the consent screen is shown fresh — this app
always requests `prompt=consent` on login specifically so a valid refresh token is issued every
time. If it still fails (e.g. you revoked access from Google's side), go to
https://myaccount.google.com/permissions, remove this app, and sign in again from the
dashboard.
