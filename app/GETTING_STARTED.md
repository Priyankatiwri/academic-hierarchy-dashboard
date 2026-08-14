# Getting Started (Newbie Guide)

This is the plain-English version — just the steps, in order. If something doesn't make
sense or you want to know *why* a step exists, the fuller docs are linked at the bottom.

You'll need about 15–20 minutes, and:
- A computer (Windows, Mac, or Linux)
- A Google account
- Internet access

---

## Part 1 — Install two free tools (skip anything you already have)

1. **Node.js** — go to [nodejs.org](https://nodejs.org), download the version marked **LTS**,
   install it like any normal program.
2. **Git** — go to [git-scm.com](https://git-scm.com/downloads), download, install.
   *(Optional: if you'd rather not install Git, you can download the code as a ZIP file from
   GitHub instead — see Part 2, option B.)*

To check they installed correctly, open a terminal (**Command Prompt** on Windows, **Terminal**
on Mac) and type:
```
node -v
git -v
```
Each should print a version number, not an error.

---

## Part 2 — Get the project code onto your computer

**Option A — using Git (recommended):**
```
git clone <the GitHub URL you were given>
cd academic-hierarchy-dashboard
git checkout iteration_1
```

**Option B — no Git:** open the GitHub page you were given in a browser → green **Code** button
→ **Download ZIP** → unzip it anywhere. (If your version doesn't have an `iteration_1` branch
option on GitHub, you already have the right code — skip the `checkout` step.)

Everything from here happens inside the `app` folder:
```
cd app
```

---

## Part 3 — Install the project's dependencies

Still inside the `app` folder, run:
```
npm install
```
This downloads everything the project needs. It'll print a bunch of text and take under a
minute — that's normal.

---

## Part 4 — Google sign-in setup

The app needs permission to read a Google Drive folder. There are two ways to get this set up
— **use Path A if someone else already has this app running** (much faster); use Path B only
if you're the very first person setting this up with nobody to ask.

### Path A — someone already set this up (do this if you can)

Ask them for two things:
1. Their **Client ID** and **Client Secret** (two strings of letters/numbers).
2. To add your Google email as a **Test user** on their project — they can do this in about a
   minute; it doesn't require any action from you.

That's it — skip to Part 5.

### Path B — you're the first person, starting from scratch

This involves Google Cloud Console, which has a few more steps. Follow
**[credentials/README.md](credentials/README.md)** in this same folder — it walks through the
exact screens. Come back here once you have a Client ID and Client Secret.

> ⚠️ If your Google account is through a school/college/company (not a plain @gmail.com), the
> organization may have Google Cloud Platform turned off for its accounts, and you'll hit an
> error trying to create a project. If that happens, don't fight it — ask a friend who has an
> unrestricted Google account (or already has this app set up) to do Path A for you instead.

---

## Part 5 — Configure the app

Still in the `app` folder, make a copy of the settings template:

**Windows:**
```
copy .env.example .env
```
**Mac/Linux:**
```
cp .env.example .env
```

Open the new `.env` file in any text editor (Notepad is fine) and fill in the two values from
Part 4:
```
GOOGLE_OAUTH_CLIENT_ID=<paste here>
GOOGLE_OAUTH_CLIENT_SECRET=<paste here>
```
Leave everything else in the file exactly as it is. Save the file.

---

## Part 6 — Run it

```
npm start
```
You should see:
```
Academic dashboard running at http://localhost:3000
```
Open that address in your browser. Click **Connect Google Drive** in the top corner, sign in
with the Google account you set up in Part 4, and approve access.

**You're done — this now runs entirely on your own computer.** To stop it, go back to the
terminal window and press `Ctrl+C`. To start it again later, repeat just this Part 6 (`npm
start` from inside the `app` folder).

---

## Part 7 (optional) — Put it online for free, so it doesn't only run on your laptop

Skip this if running it locally is enough for you. Do this if you want a permanent web address
that works even when your laptop is off.

You need three free accounts. All of this is free — no credit card charges at any point in this
guide.

### 7.1 — Turso (where the data lives)

1. Go to [turso.tech](https://turso.tech), sign up (free).
2. Create a new database from the dashboard — any name is fine.
3. On the database's page, find its **URL** (starts with `libsql://`) and create a new **auth
   token**. Copy both somewhere safe — you'll paste them into Render in the next step.

### 7.2 — Render (where the app runs)

1. Go to [render.com](https://render.com), sign up — easiest is "Sign up with GitHub."
2. **New → Web Service** → connect the same GitHub repository you cloned in Part 2.
3. When it asks for settings:
   - **Root Directory**: `app` (important — the project's code lives inside this subfolder)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Add these **Environment Variables** (same screen, or in Settings afterward):
   - `TURSO_DATABASE_URL` — the URL from step 7.1
   - `TURSO_AUTH_TOKEN` — the token from step 7.1
   - `GOOGLE_OAUTH_CLIENT_ID` — same value as your local `.env`
   - `GOOGLE_OAUTH_CLIENT_SECRET` — same value as your local `.env`
   - `GOOGLE_OAUTH_REDIRECT_URI` — leave blank for now, come back to this in step 7.4
5. Click **Create Web Service** and wait for it to deploy (a few minutes).

### 7.3 — Note your new web address

Once deployed, Render shows you a URL like `https://your-app-name.onrender.com`. That's your
site's permanent address.

### 7.4 — Point Google at your new address

Your Google sign-in was only ever told about `localhost` — it needs to know about the real
website now too:

1. In Google Cloud Console, open your OAuth Client (under **Google Auth Platform → Clients**).
2. Under **Authorized redirect URIs**, add:
   `https://your-app-name.onrender.com/auth/google/callback` (use your real Render address).
3. Save.
4. Back in Render's environment variables, set `GOOGLE_OAUTH_REDIRECT_URI` to that exact same
   address and save — Render will redeploy automatically.

### 7.5 — Keep it awake and syncing (cron-job.org)

Free Render sites fall asleep after 15 minutes of no visitors, which would stop the automatic
Drive syncing. Fix this with a free "ping" service:

1. Go to [cron-job.org](https://cron-job.org), sign up (free).
2. Create a new cron job:
   - **URL**: `https://your-app-name.onrender.com/api/sync`
   - **Method**: POST
   - **Schedule**: every 15 minutes
3. Save.

This single free service both keeps your site awake *and* triggers the Drive sync reliably.

### 7.6 — Visit your live site

Open `https://your-app-name.onrender.com`, click **Connect Google Drive**, sign in again (this
new deployment needs its own sign-in, separate from your local one), and you're live.

---

## If something goes wrong

- **"Insufficient permission" or "invalid_grant" errors**: almost always means the Google
  sign-in needs to be redone. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
  remove the app, then click **Connect Google Drive** again on the dashboard.
- **Anything else**: the more detailed guides in this folder explain the reasoning behind each
  piece — [README.md](README.md) (full setup + deployment details) and
  [credentials/README.md](credentials/README.md) (Google Cloud Console walkthrough).
